// Live data clients. All calls go straight from the browser:
//  - OneMap (search, routing): CORS-enabled; token fetched and refreshed here.
//  - arrivelah2.busrouter.sg (bus arrivals): CORS-enabled, no key.
//  - LTA DataMall (train alerts; optional bus arrivals): no CORS, so it needs
//    a forwarder at `datamallBase` (Vite provides /datamall in dev/preview).
import { findInterchange, lineFromAlertCode, lineFromStationCode, lineMeta, periodAt } from './network';
import { loadNetwork, planRoutes, searchNetwork, type PlanContext } from './router';
import { settingsStore } from './store';
import type { BusArrival, Itinerary, LatLng, Leg, LegMode, Place, Stop, TrainAlert } from './types';
import { mockApi } from './mock';

export type RouteMode = 'TRANSIT' | 'RAIL' | 'BUS';

export interface Api {
  search(query: string): Promise<Place[]>;
  /** ctx: planning from inside interchange X mid-trip (used by the built-in router). */
  route(from: LatLng, to: LatLng, mode: RouteMode, at: number, ctx?: PlanContext): Promise<Itinerary[]>;
  busArrivals(stopCode: string): Promise<Record<string, BusArrival[]>>;
  /** null = alerts unavailable (no key / no forwarder). */
  trainAlerts(): Promise<TrainAlert[] | null>;
}

export const getApi = (): Api => {
  const s = settingsStore.get();
  if (s.demo) return mockApi;
  return s.routing === 'builtin' ? builtinApi : liveApi;
};

const ONEMAP = 'https://www.onemap.gov.sg';
const ARRIVELAH = 'https://arrivelah2.busrouter.sg';

// ---------- OneMap ----------

async function onemapToken(): Promise<string> {
  const s = settingsStore.get();
  const now = Date.now() / 1000;
  if (s.onemapToken && (!s.onemapTokenExpiry || s.onemapTokenExpiry > now + 300)) return s.onemapToken;
  if (!s.onemapEmail || !s.onemapPassword) {
    if (s.onemapToken) return s.onemapToken; // expired paste-in token: try anyway
    throw new Error('OneMap token missing: add your OneMap account in Settings.');
  }
  const res = await fetch(`${ONEMAP}/api/auth/post/getToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: s.onemapEmail, password: s.onemapPassword }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) throw new Error(`OneMap login failed: ${json.error ?? res.status}`);
  settingsStore.patch({ onemapToken: json.access_token, onemapTokenExpiry: Number(json.expiry_timestamp) || now + 3 * 86400 });
  return json.access_token;
}

let authStyle: 'raw' | 'bearer' = 'raw';
async function onemapGet(path: string, needsToken: boolean): Promise<any> {
  const url = `${ONEMAP}${path}`;
  const token = needsToken ? await onemapToken() : settingsStore.get().onemapToken;
  const attempt = (style: 'raw' | 'bearer') =>
    fetch(url, { headers: token ? { Authorization: style === 'bearer' ? `Bearer ${token}` : token } : {} });
  let res = await attempt(authStyle);
  if ((res.status === 401 || res.status === 403) && token) {
    const other = authStyle === 'raw' ? 'bearer' : 'raw';
    const retry = await attempt(other);
    if (retry.ok) authStyle = other;
    res = retry;
  }
  if (!res.ok) throw new Error(`OneMap ${res.status}`);
  return res.json();
}

function sgDateTime(t: number) {
  const d = new Date(t + 8 * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}-${d.getUTCFullYear()}`,
    time: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:00`,
  };
}

const num = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number(v));

function parseStop(s: any): Stop {
  return {
    name: String(s?.name ?? ''),
    code: s?.stopCode ? String(s.stopCode) : undefined,
    time: num(s?.arrival),
    lat: num(s?.lat),
    lng: num(s?.lon),
  };
}

function legLine(l: any): string | undefined {
  for (const v of [l.routeShortName, l.route, l.routeId]) {
    if (!v) continue;
    const s = String(v).toUpperCase();
    if (lineMeta(s)) return s;
    const fromAlert = lineFromAlertCode(s);
    if (fromAlert) return fromAlert;
  }
  return lineFromStationCode(l.from?.stopCode) ?? lineFromStationCode(l.to?.stopCode) ?? (l.route ? String(l.route) : undefined);
}

export function parseOneMapItineraries(json: any): Itinerary[] {
  const its: any[] = json?.plan?.itineraries ?? [];
  return its.map((it) => {
    const legs: Leg[] = (it.legs ?? []).map((l: any): Leg => {
      const raw = String(l.mode ?? '').toUpperCase();
      const mode: LegMode = raw === 'WALK' ? 'WALK' : raw === 'BUS' ? 'BUS' : 'RAIL';
      const startTime = Number(l.startTime);
      const endTime = Number(l.endTime);
      return {
        mode,
        durationSec: Number(l.duration) || (endTime - startTime) / 1000,
        startTime,
        endTime,
        route: mode === 'BUS' ? String(l.route ?? l.routeShortName ?? '') : mode === 'RAIL' ? legLine(l) : undefined,
        from: parseStop(l.from),
        to: parseStop(l.to),
        stops: (l.intermediateStops ?? []).map(parseStop),
      };
    });
    return { legs, durationSec: Number(it.duration), startTime: Number(it.startTime), endTime: Number(it.endTime) };
  });
}

// ---------- Bus arrivals ----------

async function arrivelah(stop: string): Promise<Record<string, BusArrival[]>> {
  const res = await fetch(`${ARRIVELAH}/?id=${encodeURIComponent(stop)}`);
  if (!res.ok) throw new Error(`Bus arrivals ${res.status}`);
  const json = await res.json();
  const out: Record<string, BusArrival[]> = {};
  for (const s of json.services ?? []) {
    out[String(s.no)] = [s.next, s.next2, s.next3]
      .filter((b: any) => b?.time)
      .map((b: any) => ({ etaMs: Date.parse(b.time), monitored: Number(b.monitored) === 1 }));
  }
  return out;
}

function datamallFetch(path: string) {
  const s = settingsStore.get();
  if (!s.datamallKey) throw new Error('DataMall AccountKey missing');
  if (!s.datamallBase) throw new Error('DataMall forwarder URL not set');
  return fetch(`${s.datamallBase.replace(/\/$/, '')}/ltaodataservice/${path}`, {
    headers: { AccountKey: s.datamallKey, accept: 'application/json' },
  });
}

async function datamallBus(stop: string): Promise<Record<string, BusArrival[]>> {
  const res = await datamallFetch(`v3/BusArrival?BusStopCode=${encodeURIComponent(stop)}`);
  if (!res.ok) throw new Error(`DataMall ${res.status}`);
  const json = await res.json();
  const out: Record<string, BusArrival[]> = {};
  for (const s of json.Services ?? []) {
    out[String(s.ServiceNo)] = [s.NextBus, s.NextBus2, s.NextBus3]
      .filter((b: any) => b?.EstimatedArrival)
      .map((b: any) => ({ etaMs: Date.parse(b.EstimatedArrival), monitored: Number(b.Monitored) === 1 }));
  }
  return out;
}

export function parseTrainAlerts(json: any): TrainAlert[] {
  const v = json?.value ?? {};
  if (Number(v.Status) !== 2 && !(v.AffectedSegments ?? []).length) return [];
  const messages: string[] = (v.Message ?? []).map((m: any) => String(m.Content ?? '')).filter(Boolean);
  const segs: any[] = v.AffectedSegments ?? [];
  if (!segs.length) return messages.length ? [{ lines: [], message: messages.join(' ') }] : [];
  return segs.map((seg) => {
    const line = lineFromAlertCode(String(seg.Line ?? '')) ?? String(seg.Line ?? '');
    const msg = messages.find((m) => m.includes(String(seg.Line))) ?? messages[0] ?? `${seg.Line} disrupted (${seg.Stations ?? ''})`;
    return { lines: [line], message: msg };
  });
}

// ---------- Live API with small caches ----------

const cache = new Map<string, { at: number; value: Promise<any> }>();
function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = fn();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  return value;
}

const liveApi: Api = {
  async search(query) {
    const q = encodeURIComponent(query);
    const json = await onemapGet(`/api/common/elastic/search?searchVal=${q}&returnGeom=Y&getAddrDetails=Y&pageNum=1`, false);
    return (json.results ?? []).slice(0, 10).map((r: any, i: number) => ({
      id: `s${i}`,
      name: r.BUILDING && r.BUILDING !== 'NIL' ? r.BUILDING : r.SEARCHVAL,
      address: r.ADDRESS,
      lat: Number(r.LATITUDE),
      lng: Number(r.LONGITUDE),
    }));
  },
  route(from, to, mode, at) {
    const { date, time } = sgDateTime(at);
    const key = `route:${from.lat.toFixed(5)},${from.lng.toFixed(5)}>${to.lat.toFixed(5)},${to.lng.toFixed(5)}:${mode}:${date}T${time.slice(0, 4)}`;
    // Cached ~10 min: OneMap's rate limit isn't published and timetables don't move.
    return cached(key, 10 * 60_000, async () => {
      const path = `/api/public/routingsvc/route?start=${from.lat},${from.lng}&end=${to.lat},${to.lng}&routeType=pt&date=${date}&time=${encodeURIComponent(time)}&mode=${mode}&maxWalkDistance=1000&numItineraries=3`;
      return parseOneMapItineraries(await onemapGet(path, true));
    });
  },
  busArrivals(stop) {
    const src = settingsStore.get().busSource;
    return cached(`bus:${src}:${stop}`, 20_000, () => (src === 'datamall' ? datamallBus(stop) : arrivelah(stop)));
  },
  trainAlerts() {
    const s = settingsStore.get();
    if (!s.datamallKey || !s.datamallBase) return Promise.resolve(null);
    return cached('alerts', 60_000, async () => {
      try {
        const res = await datamallFetch('TrainServiceAlerts');
        if (!res.ok) return null;
        return parseTrainAlerts(await res.json());
      } catch {
        return null; // network/CORS failure -> unavailable, not "no disruption"
      }
    });
  },
};

// ---------- Built-in routing (no OneMap) ----------
// Same live bus arrivals and alerts; search and routing run locally over the
// bundled stop/station snapshot (public/data/transit.json).
const builtinApi: Api = {
  async search(query) {
    return searchNetwork(await loadNetwork(), query);
  },
  async route(from, to, mode, at, ctx) {
    const net = await loadNetwork();
    const s = settingsStore.get();
    const key = `broute:${from.lat.toFixed(5)},${from.lng.toFixed(5)}>${to.lat.toFixed(5)},${to.lng.toFixed(5)}:${mode}:${Math.round(at / 600_000)}:${ctx?.stationName}:${ctx?.currentLine}:${ctx?.prevStation}`;
    return cached(key, 10 * 60_000, async () =>
      planRoutes(net, from, to, mode, at, {
        // Expected wait = half a headway.
        railWaitSec: (line) => ((s.headways[line]?.[periodAt(at)] ?? 6) * 60) / 2,
        busWaitSec: (s.defaultBusHeadwayMin * 60) / 2,
        walkTransferSec: (name) => {
          const id = findInterchange(name)?.id;
          return ((id ? s.walkOverrides[id] : undefined) ?? s.defaultWalkMin) * 60;
        },
      }, ctx),
    );
  },
  busArrivals: (stop) => liveApi.busArrivals(stop),
  trainAlerts: () => liveApi.trainAlerts(),
};
