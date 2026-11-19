import { describe, expect, it } from 'vitest';
import { headline, mulberry32, runEngine, type Candidate, type EngineInput } from './engine';
import type { BusArrivals, Itinerary, Leg } from './types';

const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 19, 2, 0); // 10:00 SGT

function leg(mode: Leg['mode'], min: number, opts: Partial<Leg> = {}): Leg {
  return {
    mode,
    durationSec: min * 60,
    startTime: 0,
    endTime: 0,
    from: { name: 'Bishan' },
    to: { name: 'Somewhere' },
    stops: [],
    ...opts,
  };
}
const itin = (...legs: Leg[]): Itinerary => ({ legs, durationSec: legs.reduce((a, l) => a + l.durationSec, 0), startTime: 0, endTime: 0 });

function input(candidates: Candidate[], busArrivals: BusArrivals = {}, over: Partial<EngineInput> = {}): EngineInput {
  return {
    t0: T0,
    currentLine: 'NS',
    candidates,
    busArrivals,
    headwayMin: () => 6,
    walkTransferMin: () => 3,
    params: { samples: 2000, sigmaMonitoredMin: 1, sigmaUnmonitoredMin: 3, defaultBusHeadwayMin: 10 },
    rng: mulberry32(42),
    ...over,
  };
}

// Rail: change to CC (3 min walk + U(0,6) wait) + 10 min ride => 13..19, median ~16
const railCC: Candidate = { id: 'r', kind: 'rail', label: 'CC', itinerary: itin(leg('RAIL', 10, { route: 'CC' })) };
// Bus: 2 min walk to stop 53009, ride 8 min
const bus166 = (ride = 8): Candidate => ({
  id: 'b',
  kind: 'bus',
  label: '166',
  itinerary: itin(leg('WALK', 2), leg('BUS', ride, { route: '166', from: { name: 'Opp Bishan Stn', code: '53009' } })),
});

describe('runEngine', () => {
  it('prefers a monitored bus that is catchable and short', () => {
    const arrivals: BusArrivals = { '53009': { '166': [{ etaMs: T0 + 4 * MIN, monitored: true }, { etaMs: T0 + 14 * MIN, monitored: true }] } };
    const r = runEngine(input([railCC, bus166()], arrivals));
    // bus: board ~4 min, +8 => ~12 min; rail ~16 min
    expect(r.pBusWins).toBeGreaterThan(0.85);
    expect(r.bestBus!.medianArrival).toBeLessThan(r.bestRail!.medianArrival);
  });

  it('skips a bus that leaves before the walk to the stop is done', () => {
    // First bus due now (walk is 2 min = 2σ, so ~2% catchable), next at +20
    const arrivals: BusArrivals = { '53009': { '166': [{ etaMs: T0, monitored: true }, { etaMs: T0 + 20 * MIN, monitored: true }] } };
    const r = runEngine(input([railCC, bus166()], arrivals));
    expect(r.bestBus!.medianArrival).toBeGreaterThan(T0 + 25 * MIN);
    expect(r.pBusWins).toBeLessThan(0.05);
  });

  it('adds one headway when no listed bus is catchable', () => {
    const arrivals: BusArrivals = { '53009': { '166': [{ etaMs: T0 + 0.5 * MIN, monitored: true }] } };
    const r = runEngine(input([bus166(5)], arrivals, { params: { samples: 2000, sigmaMonitoredMin: 0.01, sigmaUnmonitoredMin: 3, defaultBusHeadwayMin: 10 } }));
    // 0.5 + 10 headway + 5 ride = 15.5
    expect((r.bestBus!.medianArrival - T0) / MIN).toBeCloseTo(15.5, 0);
  });

  it('staying on the same line costs no walk or wait', () => {
    const stay: Candidate = { id: 's', kind: 'rail', label: 'NS', itinerary: itin(leg('RAIL', 10, { route: 'NS' })) };
    const r = runEngine(input([stay]));
    expect(r.bestRail!.p10).toBe(T0 + 10 * MIN);
    expect(r.bestRail!.p90).toBe(T0 + 10 * MIN);
  });

  it('same line but heading back the way we came is a new train', () => {
    // Riding NS into Bishan from Ang Mo Kio; leg goes NS back towards Ang Mo Kio.
    const back: Candidate = { id: 'b', kind: 'rail', label: 'NS', itinerary: itin(leg('RAIL', 10, { route: 'NS', to: { name: 'Ang Mo Kio' } })) };
    const r = runEngine(input([back], {}, { prevStation: 'ANG MO KIO MRT STATION' }));
    expect(r.bestRail!.p10).toBeGreaterThan(T0 + 12 * MIN); // walk 3 + wait + ride
  });

  it('changing line adds walk + uniform wait within the headway', () => {
    const r = runEngine(input([railCC]));
    const med = (r.bestRail!.medianArrival - T0) / MIN;
    expect(med).toBeGreaterThan(15);
    expect(med).toBeLessThan(17);
    expect((r.bestRail!.p10 - T0) / MIN).toBeGreaterThanOrEqual(13);
    expect((r.bestRail!.p90 - T0) / MIN).toBeLessThanOrEqual(19);
  });

  it('is about even when the options are symmetric', () => {
    // Bus: unmonitored ETA exactly at the median rail time minus ride
    const arrivals: BusArrivals = { '53009': { '166': [{ etaMs: T0 + 8 * MIN, monitored: true }] } };
    const r = runEngine(input([railCC, bus166(8)], arrivals, { params: { samples: 4000, sigmaMonitoredMin: 1.7, sigmaUnmonitoredMin: 3, defaultBusHeadwayMin: 10 } }));
    expect(r.pBusWins).toBeGreaterThan(0.3);
    expect(r.pBusWins).toBeLessThan(0.7);
  });

  it('P(fastest) sums to 1', () => {
    const arrivals: BusArrivals = { '53009': { '166': [{ etaMs: T0 + 6 * MIN, monitored: false }] } };
    const r = runEngine(input([railCC, bus166()], arrivals));
    expect(r.routes.reduce((a, x) => a + x.pFastest, 0)).toBeCloseTo(1, 6);
  });

  it('ignores in-station walks between rail legs (uses the walk table)', () => {
    const viaWalk: Candidate = {
      id: 'w',
      kind: 'rail',
      label: 'NS→CC',
      itinerary: itin(
        leg('WALK', 4, { from: { name: 'BISHAN MRT STATION' }, to: { name: 'BISHAN MRT STATION' } }),
        leg('RAIL', 10, { route: 'CC', from: { name: 'Bishan MRT Station' } }),
      ),
    };
    const a = runEngine(input([viaWalk]));
    const b = runEngine(input([railCC]));
    expect(a.bestRail!.medianArrival).toBe(b.bestRail!.medianArrival);
  });
});

describe('headline', () => {
  it('formats the winner out of 10', () => {
    expect(headline(0.7).text).toBe('🚌 Bus wins 7/10');
    expect(headline(0.2).text).toBe('🚇 Train wins 8/10');
    expect(headline(0.5).winner).toBe('bus');
    expect(headline(0.46).text).toBe('🚇 Train wins 5/10');
  });
});
