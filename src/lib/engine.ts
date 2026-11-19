// Verdict engine (PRD §8). Pure: no I/O, no clock, seedable RNG.
import type { BusArrivals, Itinerary, Leg, RouteSummary } from './types';
import { normaliseStationName } from './network';

export interface EngineParams {
  samples: number;
  sigmaMonitoredMin: number;
  sigmaUnmonitoredMin: number;
  defaultBusHeadwayMin: number;
}

export interface Candidate {
  id: string;
  kind: 'rail' | 'bus';
  label: string;
  itinerary: Itinerary;
}

export interface EngineInput {
  /** Estimated time the user reaches interchange X (epoch ms). */
  t0: number;
  /** Line the user is riding into X ("NS"); staying on it costs no walk or wait. */
  currentLine?: string;
  /** Station before X on that ride. A same-line leg heading back there is a different train. */
  prevStation?: string;
  candidates: Candidate[];
  busArrivals: BusArrivals;
  /** Scheduled headway in minutes for a line at time t. */
  headwayMin: (line: string, t: number) => number;
  /** Walk from platform to platform at a station, in minutes. */
  walkTransferMin: (stationName: string, line: string) => number;
  params: EngineParams;
  rng?: () => number;
}

export interface EngineResult {
  routes: RouteSummary[];
  bestRail?: RouteSummary;
  bestBus?: RouteSummary;
  pBusWins?: number;
}

const MIN = 60_000;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Classify an itinerary: any bus leg makes it a bus option. */
export function kindOf(it: Itinerary): 'rail' | 'bus' {
  return it.legs.some((l) => l.mode === 'BUS') ? 'bus' : 'rail';
}

export function describe(it: Itinerary): string {
  const parts = it.legs.filter((l) => l.mode !== 'WALK').map((l) => (l.mode === 'BUS' ? `🚌${l.route ?? '?'}` : `🚇${l.route ?? '?'}`));
  return parts.length ? parts.join(' → ') : '🚶 walk';
}

/**
 * A walk that stays inside one station complex (OneMap sometimes emits these
 * between rail legs). The walk table models those instead (PRD §11).
 */
function isInStationWalk(legs: Leg[], i: number): boolean {
  const leg = legs[i];
  if (leg.mode !== 'WALK') return false;
  const prev = legs[i - 1];
  const next = legs[i + 1];
  const touchesRail = (prev === undefined || prev.mode === 'RAIL') && next?.mode === 'RAIL';
  if (!touchesRail) return false;
  const a = normaliseStationName(prev ? prev.to.name : leg.from.name);
  const b = normaliseStationName(next.from.name);
  return a === b || leg.durationSec <= 90;
}

function gaussian(rng: () => number): number {
  let u = 0;
  while (u === 0) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * One sample of total arrival time for an itinerary starting at X at t0.
 * `draw(key)` returns a per-sample cached uniform so routes sharing the same
 * bus or the same train wait see the same luck.
 */
function simulate(input: EngineInput, it: Itinerary, draw: (key: string) => number, gauss: (key: string) => number): number {
  const { t0, currentLine, prevStation, busArrivals, headwayMin, walkTransferMin, params } = input;
  let t = t0;
  let onLine: string | undefined = currentLine; // the train we're sitting on, if any
  let inStation = true; // at X we step off a train, so we start inside the paid area
  const legs = it.legs;
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    if (leg.mode === 'WALK') {
      if (isInStationWalk(legs, i)) continue; // covered by the walk table
      t += leg.durationSec * 1000;
      onLine = undefined;
      inStation = false;
      continue;
    }
    if (leg.mode === 'RAIL') {
      const line = leg.route ?? '?';
      const nextStop = leg.stops[0] ?? leg.to;
      const reverses = onLine === currentLine && prevStation !== undefined && normaliseStationName(nextStop.name) === normaliseStationName(prevStation);
      if (onLine === undefined || line !== onLine || reverses) {
        // Change trains: platform walk (only when already inside the station), then wait.
        if (inStation) t += walkTransferMin(leg.from.name, line) * MIN;
        const h = headwayMin(line, t) * MIN;
        t += draw(`rail:${normaliseStationName(leg.from.name)}:${line}`) * h;
      } // else: stay on the same train, no walk, no wait
      t += leg.durationSec * 1000;
      onLine = line;
      inStation = true;
      continue;
    }
    // BUS
    onLine = undefined;
    inStation = false;
    const stop = leg.from.code ?? '';
    const svc = leg.route ?? '';
    const buses = busArrivals[stop]?.[svc] ?? [];
    const h = estimateBusHeadway(buses.map((b) => b.etaMs)) ?? params.defaultBusHeadwayMin * MIN;
    let board: number | undefined;
    let lastSampled = -Infinity;
    const sampled = buses
      .map((b, k) => {
        const sigma = (b.monitored ? params.sigmaMonitoredMin : params.sigmaUnmonitoredMin) * MIN;
        return b.etaMs + gauss(`bus:${stop}:${svc}:${k}`) * sigma;
      })
      .sort((a, b) => a - b);
    for (const eta of sampled) {
      lastSampled = Math.max(lastSampled, eta);
      if (eta >= t) {
        board = eta;
        break;
      }
    }
    if (board === undefined) {
      if (sampled.length) {
        board = lastSampled + h; // PRD: none catchable -> +1 scheduled headway
        if (board < t) board = t + draw(`busw:${stop}:${svc}`) * h;
      } else {
        board = t + draw(`busw:${stop}:${svc}`) * h; // no live data: random wait within a headway
      }
    }
    t = board + leg.durationSec * 1000;
  }
  return t;
}

function estimateBusHeadway(etas: number[]): number | undefined {
  if (etas.length < 2) return undefined;
  const s = [...etas].sort((a, b) => a - b);
  const gap = (s[s.length - 1] - s[0]) / (s.length - 1);
  return gap > 2 * MIN ? gap : undefined;
}

const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];

export function runEngine(input: EngineInput): EngineResult {
  const rng = input.rng ?? Math.random;
  const n = Math.max(50, Math.round(input.params.samples));
  const cands = input.candidates;
  const results: number[][] = cands.map(() => new Array(n));
  const fastestCount = new Array(cands.length).fill(0);

  for (let s = 0; s < n; s++) {
    const uni = new Map<string, number>();
    const gau = new Map<string, number>();
    const draw = (k: string) => {
      let v = uni.get(k);
      if (v === undefined) uni.set(k, (v = rng()));
      return v;
    };
    const gauss = (k: string) => {
      let v = gau.get(k);
      if (v === undefined) gau.set(k, (v = gaussian(rng)));
      return v;
    };
    let best = Infinity;
    let bestIdx: number[] = [];
    cands.forEach((c, i) => {
      const t = simulate(input, c.itinerary, draw, gauss);
      results[i][s] = t;
      if (t < best - 1) {
        best = t;
        bestIdx = [i];
      } else if (Math.abs(t - best) <= 1) bestIdx.push(i);
    });
    for (const i of bestIdx) fastestCount[i] += 1 / bestIdx.length;
  }

  const routes: RouteSummary[] = cands.map((c, i) => {
    const sorted = [...results[i]].sort((a, b) => a - b);
    return {
      id: c.id,
      kind: c.kind,
      label: c.label,
      medianArrival: quantile(sorted, 0.5),
      p10: quantile(sorted, 0.1),
      p90: quantile(sorted, 0.9),
      pFastest: fastestCount[i] / n,
      itinerary: c.itinerary,
    };
  });

  const pick = (kind: 'rail' | 'bus') => {
    const idx = routes.map((r, i) => [r, i] as const).filter(([r]) => r.kind === kind);
    if (!idx.length) return undefined;
    return idx.reduce((a, b) => (b[0].medianArrival < a[0].medianArrival ? b : a));
  };
  const rail = pick('rail');
  const bus = pick('bus');
  let pBusWins: number | undefined;
  if (rail && bus) {
    let wins = 0;
    for (let s = 0; s < n; s++) {
      const d = results[bus[1]][s] - results[rail[1]][s];
      wins += d < -1 ? 1 : Math.abs(d) <= 1 ? 0.5 : 0;
    }
    pBusWins = wins / n;
  }
  return { routes, bestRail: rail?.[0], bestBus: bus?.[0], pBusWins };
}

/** P(bus wins) -> "🚌 Bus wins 7/10" or "🚇 Train wins 6/10" (the winner always shows ≥5/10). */
export function headline(pBusWins: number): { text: string; winner: 'rail' | 'bus' } {
  const busTenths = Math.round(pBusWins * 10);
  if (busTenths >= 5 && pBusWins >= 0.5) {
    const n = Math.min(10, Math.max(5, busTenths));
    return { text: `🚌 Bus wins ${n}/10`, winner: 'bus' };
  }
  const n = Math.min(10, Math.max(5, Math.round((1 - pBusWins) * 10)));
  return { text: `🚇 Train wins ${n}/10`, winner: 'rail' };
}
