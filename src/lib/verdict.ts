// Orchestrates one verdict: OneMap X→B ×2 + bus arrivals + alerts → engine.
import { getApi } from './api';
import { describe, headline, kindOf, runEngine, type Candidate } from './engine';
import { findInterchange, periodAt } from './network';
import { logStore, settingsStore } from './store';
import { etaOf } from './trip';
import { USER_ID, type BusArrivals, type InterchangePoint, type Itinerary, type Trip, type Verdict, type VerdictLogEntry } from './types';

const MIN = 60_000;

function dedupe(its: Itinerary[]): Itinerary[] {
  const seen = new Set<string>();
  return its.filter((it) => {
    const k = describe(it) + Math.round(it.durationSec / 60);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function computeVerdict(trip: Trip, ic: InterchangePoint, now = Date.now()): Promise<Verdict> {
  const api = getApi();
  const settings = settingsStore.get();
  const t0 = Math.max(etaOf(trip, ic), now);
  const base: Pick<Verdict, 'interchangeId' | 'computedAt' | 't0'> = { interchangeId: ic.id, computedAt: now, t0 };

  try {
    // Round the query time to 10 min so the per-trip route cache gets hits.
    const qTime = Math.round(t0 / (10 * MIN)) * 10 * MIN;
    const ctx = { stationName: ic.name, currentLine: ic.currentLine, prevStation: ic.prevStation };
    const [railIts, busIts, alerts] = await Promise.all([
      api.route(ic, trip.destination, 'RAIL', qTime, ctx).catch(() => [] as Itinerary[]),
      api.route(ic, trip.destination, 'BUS', qTime, ctx).catch(() => [] as Itinerary[]),
      api.trainAlerts().catch(() => null),
    ]);
    if (!railIts.length && !busIts.length) throw new Error('OneMap returned no routes from here');

    const all = dedupe([...railIts, ...busIts]);
    const rails = all.filter((i) => kindOf(i) === 'rail').slice(0, 3);
    const buses = all.filter((i) => kindOf(i) === 'bus').slice(0, 3);
    const candidates: Candidate[] = [...rails, ...buses].map((it, i) => ({ id: `c${i}`, kind: kindOf(it), label: describe(it), itinerary: it }));

    // Live arrivals for every bus boarding stop in the candidates.
    const stops = [...new Set(buses.flatMap((it) => it.legs.filter((l) => l.mode === 'BUS' && l.from.code).map((l) => l.from.code!)))];
    const busArrivals: BusArrivals = {};
    await Promise.all(
      stops.map(async (code) => {
        try {
          busArrivals[code] = await api.busArrivals(code);
        } catch {
          busArrivals[code] = {}; // engine falls back to a random wait within the default headway
        }
      }),
    );

    const result = runEngine({
      t0,
      currentLine: ic.currentLine,
      prevStation: ic.prevStation,
      candidates,
      busArrivals,
      headwayMin: (line, t) => settings.headways[line]?.[periodAt(t)] ?? 6,
      walkTransferMin: (station) => {
        const id = findInterchange(station)?.id;
        return (id ? settings.walkOverrides[id] : undefined) ?? settings.defaultWalkMin;
      },
      params: settings,
    });

    // Disruption override (PRD §8.4): current line or a line the rail option uses.
    const railLines = new Set([ic.currentLine, ...(result.bestRail?.itinerary.legs.filter((l) => l.mode === 'RAIL').map((l) => l.route ?? '') ?? [])]);
    const hits = (alerts ?? []).filter((a) => a.lines.some((l) => railLines.has(l)) || (a.lines.length === 0 && railLines.size > 0));
    const disrupted = hits.length ? { lines: [...new Set(hits.flatMap((h) => h.lines))], message: hits.map((h) => h.message).join(' ') } : undefined;

    let recommendation: Verdict['recommendation'];
    let text: string;
    let pBusWins = result.pBusWins;
    if (disrupted) {
      pBusWins = undefined;
      recommendation = result.bestBus ? 'bus' : 'rail';
      text = result.bestBus ? '🚌 Take the bus' : '⚠️ No bus option found';
    } else if (pBusWins !== undefined) {
      const h = headline(pBusWins);
      recommendation = h.winner;
      text = h.text;
    } else if (result.bestBus) {
      recommendation = 'bus';
      text = '🚌 Bus (no rail option)';
    } else if (result.bestRail) {
      recommendation = 'rail';
      text = '🚇 Train (no bus option)';
    } else {
      recommendation = 'none';
      text = 'No options';
    }

    const verdict: Verdict = {
      ...base,
      routes: result.routes,
      bestRail: result.bestRail,
      bestBus: result.bestBus,
      pBusWins,
      disrupted,
      recommendation,
      headline: text,
      busArrivals,
      error: alerts === null && !settings.demo ? 'alerts-unavailable' : undefined,
    };
    logVerdict(trip, ic, verdict);
    return verdict;
  } catch (e) {
    return { ...base, routes: [], recommendation: 'none', headline: 'No verdict', busArrivals: {}, error: (e as Error).message };
  }
}

/** One log row per (trip, interchange): updated on each refresh until we pass X. */
function logVerdict(trip: Trip, ic: InterchangePoint, v: Verdict) {
  const id = `${trip.id}:${ic.id}`;
  const pick = (r?: Verdict['bestRail']) => r && { label: r.label, medianArrival: r.medianArrival, p10: r.p10, p90: r.p90 };
  logStore.set((log) => {
    const prev = log.find((e) => e.id === id);
    if (prev && v.computedAt > prev.t0 + MIN) return log; // already past X: keep the decision-time verdict
    const entry: VerdictLogEntry = {
      id,
      userId: USER_ID,
      tripId: trip.id,
      interchangeId: ic.id,
      interchangeName: ic.name,
      firstAt: prev?.firstAt ?? v.computedAt,
      lastAt: v.computedAt,
      refreshes: (prev?.refreshes ?? 0) + 1,
      t0: v.t0,
      pBusWins: v.pBusWins,
      recommendation: v.recommendation,
      headline: v.headline,
      rail: pick(v.bestRail),
      bus: pick(v.bestBus),
      disrupted: v.disrupted?.message,
      busArrivals: v.busArrivals,
      chosen: prev?.chosen,
      tripArrivedAt: prev?.tripArrivedAt,
    };
    return [entry, ...log.filter((e) => e.id !== id)].slice(0, 500);
  });
}

export function recordChoice(tripId: string, interchangeId: string, chosen: 'rail' | 'bus') {
  logStore.set((log) => log.map((e) => (e.id === `${tripId}:${interchangeId}` ? { ...e, chosen } : e)));
}

export function recordArrival(tripId: string, at: number) {
  logStore.set((log) => log.map((e) => (e.tripId === tripId ? { ...e, tripArrivedAt: at } : e)));
}
