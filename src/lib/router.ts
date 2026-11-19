// Built-in journey planner: no routing API. Runs Dijkstra over a graph built
// from public/data/transit.json (all MRT/LRT stations and line sequences, all
// bus stops and service stop sequences). There are no timetables, so it uses
// expected costs: wait = headway / 2, ride = distance-based hop times,
// walk = straight-line distance × detour factor. The verdict engine then
// re-simulates the chosen candidates with live bus arrivals.
import { normaliseStationName } from './network';
import type { Itinerary, LatLng, Leg, Place, Stop } from './types';

export interface TransitJson {
  generatedAt: string;
  stations: { n: string; c: string[]; y: number; x: number }[];
  rail: { l: string; s: number[] }[];
  stops: [code: string, name: string, road: string, lat: number, lng: number][];
  services: [no: string, routes: number[][]][];
}

interface Pattern {
  kind: 'rail' | 'bus';
  route: string; // line code or service number
  stops: number[]; // global stop indices
  base: number; // node id of position 0
  hop: number[]; // seconds from i to i+1
}

export interface Network {
  generatedAt: string;
  N: number; // stops: rail stations [0, R) then bus stops [R, N)
  R: number;
  names: string[];
  codes: string[][]; // station codes (rail) or [busStopCode]
  roads: string[];
  lat: Float64Array;
  lng: Float64Array;
  patterns: Pattern[];
  nodePat: Int32Array; // pattern node -> pattern index
  boardAt: number[][]; // stop -> pattern node ids you can board there
  nbr: number[][]; // stop -> [stop, walkSec, stop, walkSec, ...]
  grid: Map<string, number[]>;
  nodeCount: number; // DEST = nodeCount - 1
}

// ---------- tunables ----------
const WALK_MPS = 1.2;
const DETOUR = 1.3;
const TRANSFER_RADIUS_M = 350;
const ACCESS_RADIUS_M = 800;
const ACCESS_RADIUS_WIDE_M = 1600;
const STATION_ENTRY_S = 60; // street -> gantry (platform walk is in walkTransfer)
const STATION_EXIT_S = 120; // platform -> street
const BOARD_PENALTY_S = 150; // discourages needless transfers (search only)
const WALK_WEIGHT = 1.15; // walking feels longer than riding (search only)
const ALT_PENALTY_S = 600; // per reused pattern when looking for alternatives
const CELL = 0.004; // ~445 m grid

export function haversineM(a: LatLng, b: LatLng) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
const walkSec = (m: number) => (m * DETOUR) / WALK_MPS;

function railHopSec(m: number, line: string) {
  const lrt = line === 'BP' || line === 'SK' || line === 'PG';
  return lrt ? 30 + m / 8 : 45 + m / 16;
}
const busHopSec = (m: number) => 20 + (m * 1.25) / 6;

const cellKey = (lat: number, lng: number) => `${Math.floor(lat / CELL)}:${Math.floor(lng / CELL)}`;

export function buildNetwork(json: TransitJson): Network {
  const R = json.stations.length;
  const N = R + json.stops.length;
  const names: string[] = [];
  const codes: string[][] = [];
  const roads: string[] = [];
  const lat = new Float64Array(N);
  const lng = new Float64Array(N);
  json.stations.forEach((s, i) => {
    names[i] = s.n;
    codes[i] = s.c;
    roads[i] = '';
    lat[i] = s.y;
    lng[i] = s.x;
  });
  json.stops.forEach(([code, name, road, la, ln], j) => {
    const i = R + j;
    names[i] = name;
    codes[i] = [code];
    roads[i] = road;
    lat[i] = la;
    lng[i] = ln;
  });
  const pos = (i: number): LatLng => ({ lat: lat[i], lng: lng[i] });

  const patterns: Pattern[] = [];
  let next = 2 * N;
  const addPattern = (kind: Pattern['kind'], route: string, stops: number[]) => {
    const hop = stops.slice(1).map((s, k) => {
      const m = haversineM(pos(stops[k]), pos(s));
      return kind === 'rail' ? railHopSec(m, route) : busHopSec(m);
    });
    patterns.push({ kind, route, stops, base: next, hop });
    next += stops.length;
  };
  for (const seq of json.rail) {
    addPattern('rail', seq.l, seq.s);
    addPattern('rail', seq.l, [...seq.s].reverse());
  }
  for (const [no, routes] of json.services) for (const r of routes) addPattern('bus', no, r.map((j) => R + j));

  const nodeCount = next + 1;
  const nodePat = new Int32Array(nodeCount).fill(-1);
  const boardAt: number[][] = Array.from({ length: N }, () => []);
  patterns.forEach((p, pi) => {
    p.stops.forEach((s, k) => {
      nodePat[p.base + k] = pi;
      if (k < p.stops.length - 1) boardAt[s].push(p.base + k);
    });
  });

  const grid = new Map<string, number[]>();
  for (let i = 0; i < N; i++) {
    const k = cellKey(lat[i], lng[i]);
    let a = grid.get(k);
    if (!a) grid.set(k, (a = []));
    a.push(i);
  }
  const net: Network = { generatedAt: json.generatedAt, N, R, names, codes, roads, lat, lng, patterns, nodePat, boardAt, nbr: [], grid, nodeCount };
  net.nbr = Array.from({ length: N }, (_, i) => {
    const out: number[] = [];
    for (const [j, m] of near(net, pos(i), TRANSFER_RADIUS_M)) if (j !== i) out.push(j, walkSec(m));
    return out;
  });
  return net;
}

/** Stops within `radius` metres of a point, with distances. */
export function near(net: Network, p: LatLng, radius: number): [number, number][] {
  const span = Math.ceil(radius / 445);
  const cy = Math.floor(p.lat / CELL);
  const cx = Math.floor(p.lng / CELL);
  const out: [number, number][] = [];
  for (let dy = -span; dy <= span; dy++)
    for (let dx = -span; dx <= span; dx++) {
      for (const i of net.grid.get(`${cy + dy}:${cx + dx}`) ?? []) {
        const m = haversineM(p, { lat: net.lat[i], lng: net.lng[i] });
        if (m <= radius) out.push([i, m]);
      }
    }
  return out;
}

// ---------- search ----------

class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, val: number) {
    const k = this.k;
    const v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop(): [number, number] {
    const k = this.k;
    const v = this.v;
    const top: [number, number] = [k[0], v[0]];
    const lk = k.pop()!;
    const lv = v.pop()!;
    if (k.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= k.length) break;
        const r = l + 1;
        const c = r < k.length && k[r] < k[l] ? r : l;
        if (k[c] >= lk) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lk;
      v[i] = lv;
    }
    return top;
  }
}

export interface RouterOptions {
  allowRail: boolean;
  allowBus: boolean;
  railWaitSec: (line: string) => number;
  busWaitSec: number;
  walkTransferSec: (stationName: string) => number;
}

interface Search {
  sources: [node: number, cost: number][];
  egress: Map<number, number>; // street node -> walk sec to destination
  extra: Map<number, number>; // pattern index -> extra boarding penalty
}

function dijkstra(net: Network, opt: RouterOptions, s: Search): number[] | null {
  const { N, R, nodePat, patterns } = net;
  const DEST = net.nodeCount - 1;
  const dist = new Float64Array(net.nodeCount).fill(Infinity);
  const prev = new Int32Array(net.nodeCount).fill(-1);
  const heap = new Heap();
  for (const [n, c] of s.sources) {
    if (c < dist[n]) {
      dist[n] = c;
      heap.push(c, n);
    }
  }
  const relax = (from: number, to: number, c: number) => {
    if (c < dist[to]) {
      dist[to] = c;
      prev[to] = from;
      heap.push(c, to);
    }
  };
  while (heap.size) {
    const [d, u] = heap.pop();
    if (d > dist[u]) continue;
    if (u === DEST) break;
    if (u < N) {
      // street level at stop u
      const nb = net.nbr[u];
      for (let k = 0; k < nb.length; k += 2) relax(u, nb[k], d + nb[k + 1] * WALK_WEIGHT);
      const eg = s.egress.get(u);
      if (eg !== undefined) relax(u, DEST, d + eg * WALK_WEIGHT);
      if (u < R) relax(u, N + u, d + STATION_ENTRY_S);
      else if (opt.allowBus)
        for (const pn of net.boardAt[u]) relax(u, pn, d + opt.busWaitSec + BOARD_PENALTY_S + (s.extra.get(nodePat[pn]) ?? 0));
    } else if (u < 2 * N) {
      // inside station u - N
      const st = u - N;
      relax(u, st, d + STATION_EXIT_S);
      if (opt.allowRail) {
        const tw = opt.walkTransferSec(net.names[st]);
        for (const pn of net.boardAt[st]) {
          const p = patterns[nodePat[pn]];
          relax(u, pn, d + tw + opt.railWaitSec(p.route) + BOARD_PENALTY_S + (s.extra.get(nodePat[pn]) ?? 0));
        }
      }
    } else {
      // riding pattern p at position k
      const pi = nodePat[u];
      const p = patterns[pi];
      const k = u - p.base;
      if (k + 1 < p.stops.length) relax(u, u + 1, d + p.hop[k]);
      if (k > 0) {
        const st = p.stops[k];
        relax(u, p.kind === 'rail' ? N + st : st, d);
      }
    }
  }
  if (dist[DEST] === Infinity) return null;
  const path: number[] = [];
  for (let n = DEST; n !== -1; n = prev[n]) path.push(n);
  return path.reverse();
}

// ---------- itinerary building ----------

function lineCode(codes: string[], line: string): string | undefined {
  const prefixes: Record<string, string[]> = { SK: ['STC', 'SE', 'SW'], PG: ['PTC', 'PE', 'PW'], CG: ['CG'] };
  const want = prefixes[line] ?? [line];
  return codes.find((c) => want.some((w) => c.replace(/\d+$/, '') === w)) ?? codes[0];
}

function stopAt(net: Network, i: number, time?: number, line?: string): Stop {
  const rail = i < net.R;
  return {
    name: net.names[i],
    code: rail ? (line ? lineCode(net.codes[i], line) : net.codes[i].join('/')) : net.codes[i][0],
    time,
    lat: net.lat[i],
    lng: net.lng[i],
  };
}

function buildItinerary(net: Network, path: number[], origin: Stop, dest: Stop, accessSec: Map<number, number>, egress: Map<number, number>, opt: RouterOptions, at: number): Itinerary {
  const { N, nodePat, patterns } = net;
  const DEST = net.nodeCount - 1;
  const legs: Leg[] = [];
  let t = at;
  let walk: { from: Stop; to: Stop; start: number } | null = null;
  let here: Stop = origin;

  const addWalk = (to: Stop, sec: number) => {
    if (!walk) walk = { from: here, to, start: t };
    walk.to = to;
    t += sec * 1000;
    here = to;
  };
  const flushWalk = () => {
    if (walk && t > walk.start) legs.push({ mode: 'WALK', durationSec: (t - walk.start) / 1000, startTime: walk.start, endTime: t, from: walk.from, to: walk.to, stops: [] });
    walk = null;
  };

  const first = path[0];
  if (first < N) addWalk(stopAt(net, first), accessSec.get(first) ?? 0);
  else if (first < 2 * N) here = stopAt(net, first - N);

  let ride: { p: number; k: number; start: number } | null = first >= 2 * N ? { p: nodePat[first], k: first - patterns[nodePat[first]].base, start: t } : null;

  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (b === DEST) {
      addWalk(dest, egress.get(a) ?? 0);
      break;
    }
    if (b >= 2 * N) {
      if (a >= 2 * N && nodePat[a] === nodePat[b]) continue; // still riding
      // board
      flushWalk();
      const p = patterns[nodePat[b]];
      if (p.kind === 'rail') t += (opt.walkTransferSec(net.names[p.stops[b - p.base]]) + opt.railWaitSec(p.route)) * 1000;
      else t += opt.busWaitSec * 1000;
      ride = { p: nodePat[b], k: b - p.base, start: t };
      continue;
    }
    if (a >= 2 * N && ride) {
      // alight at position (a - base)
      const p = patterns[ride.p];
      const end = a - p.base;
      const stops: Stop[] = [];
      let tt = ride.start;
      for (let k = ride.k; k < end; k++) {
        tt += p.hop[k] * 1000;
        if (k + 1 < end) stops.push(stopAt(net, p.stops[k + 1], tt, p.kind === 'rail' ? p.route : undefined));
      }
      const line = p.kind === 'rail' ? p.route : undefined;
      legs.push({
        mode: p.kind === 'rail' ? 'RAIL' : 'BUS',
        route: p.route,
        durationSec: (tt - ride.start) / 1000,
        startTime: ride.start,
        endTime: tt,
        from: stopAt(net, p.stops[ride.k], ride.start, line),
        to: stopAt(net, p.stops[end], tt, line),
        stops,
      });
      t = tt;
      here = stopAt(net, p.stops[end]);
      ride = null;
      continue;
    }
    // street/station moves
    if (a < N && b < N) addWalk(stopAt(net, b), walkSecBetween(net, a, b));
    else if (a < N && b === N + a) addWalk(stopAt(net, a), STATION_ENTRY_S);
    else if (a === N + b) addWalk(stopAt(net, b), STATION_EXIT_S);
  }
  flushWalk();
  return { legs, durationSec: (t - at) / 1000, startTime: at, endTime: t };
}

function walkSecBetween(net: Network, a: number, b: number) {
  const nb = net.nbr[a];
  for (let k = 0; k < nb.length; k += 2) if (nb[k] === b) return nb[k + 1];
  return walkSec(haversineM({ lat: net.lat[a], lng: net.lng[a] }, { lat: net.lat[b], lng: net.lng[b] }));
}

// ---------- public API ----------

export interface PlanContext {
  /** Plan from inside this station (mid-trip at interchange X). */
  stationName?: string;
  /** Line currently ridden into X, and the station before X (gives direction). */
  currentLine?: string;
  prevStation?: string;
}

export function findStation(net: Network, name?: string): number | undefined {
  if (!name) return undefined;
  const n = normaliseStationName(name);
  for (let i = 0; i < net.R; i++) if (normaliseStationName(net.names[i]) === n) return i;
  return undefined;
}

export function planRoutes(net: Network, from: LatLng, to: LatLng, mode: 'TRANSIT' | 'RAIL' | 'BUS', at: number, opt: Omit<RouterOptions, 'allowRail' | 'allowBus'>, ctx: PlanContext = {}, k = 3): Itinerary[] {
  const options: RouterOptions = { ...opt, allowRail: mode !== 'BUS', allowBus: mode !== 'RAIL' };
  const { N } = net;

  const ring = (p: LatLng) => {
    let r = near(net, p, ACCESS_RADIUS_M);
    if (r.length < 3) r = near(net, p, ACCESS_RADIUS_WIDE_M);
    return r;
  };

  const sources: [number, number][] = [];
  const accessSec = new Map<number, number>();
  const X = findStation(net, ctx.stationName);
  if (X !== undefined) {
    sources.push([N + X, 0]);
    // Staying on the same train, in the direction of travel.
    const prev = findStation(net, ctx.prevStation);
    if (options.allowRail && ctx.currentLine && prev !== undefined) {
      net.patterns.forEach((p) => {
        if (p.kind !== 'rail' || p.route !== ctx.currentLine) return;
        for (let i = 1; i < p.stops.length - 1; i++) if (p.stops[i] === X && p.stops[i - 1] === prev) sources.push([p.base + i, 0]);
      });
    }
  } else {
    for (const [s, m] of ring(from)) {
      accessSec.set(s, walkSec(m));
      sources.push([s, walkSec(m) * WALK_WEIGHT]);
    }
  }
  const egress = new Map<number, number>();
  for (const [s, m] of ring(to)) egress.set(s, walkSec(m));
  if (!sources.length || !egress.size) return [];

  const origin: Stop = X !== undefined ? stopAt(net, X) : { name: 'Start', lat: from.lat, lng: from.lng };
  const dest: Stop = { name: 'Destination', lat: to.lat, lng: to.lng };
  const out: Itinerary[] = [];
  const seen = new Set<string>();
  const extra = new Map<number, number>();
  for (let attempt = 0; attempt < k + 3 && out.length < k; attempt++) {
    const path = dijkstra(net, options, { sources, egress, extra });
    if (!path) break;
    const it = buildItinerary(net, path, origin, dest, accessSec, egress, options, at);
    const sig = it.legs.filter((l) => l.mode !== 'WALK').map((l) => `${l.route}@${l.from.code}`).join('>');
    if (!seen.has(sig)) {
      seen.add(sig);
      out.push(it);
    }
    const used = new Set(path.filter((n) => n >= 2 * N && n < net.nodeCount - 1).map((n) => net.nodePat[n]));
    if (!used.size) break; // walking only: no alternatives to find
    for (const p of used) extra.set(p, (extra.get(p) ?? 0) + ALT_PENALTY_S);
  }
  return out.sort((a, b) => a.durationSec - b.durationSec);
}

export function searchNetwork(net: Network, query: string, limit = 12): Place[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const scored: [number, Place][] = [];
  for (let i = 0; i < net.N; i++) {
    const rail = i < net.R;
    const name = net.names[i].toLowerCase();
    const code = net.codes[i].join(' ').toLowerCase();
    const road = net.roads[i].toLowerCase();
    let score = -1;
    if (name === q || code.split(' ').includes(q)) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (name.includes(q)) score = 2;
    else if (road.includes(q)) score = 3;
    if (score < 0) continue;
    scored.push([
      score * 2 + (rail ? 0 : 1),
      {
        id: `n${i}`,
        name: rail ? `${net.names[i]} station` : net.names[i],
        address: rail ? net.codes[i].join(' / ') : `${net.roads[i]} · stop ${net.codes[i][0]}`,
        lat: net.lat[i],
        lng: net.lng[i],
      },
    ]);
  }
  return scored.sort((a, b) => a[0] - b[0]).slice(0, limit).map(([, p]) => p);
}

let loading: Promise<Network> | null = null;
export function loadNetwork(): Promise<Network> {
  if (!loading) {
    loading = fetch(`${import.meta.env.BASE_URL}data/transit.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`Transit data ${r.status}`);
        return r.json();
      })
      .then(buildNetwork);
    loading.catch(() => (loading = null));
  }
  return loading;
}
