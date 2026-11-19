import { findInterchange, normaliseStationName } from './network';
import type { InterchangePoint, Itinerary, Stop, Trip } from './types';

/**
 * Every interchange the itinerary passes through or transfers at, with its
 * scheduled offset from the itinerary start (PRD §8: ETA = trip start +
 * OneMap scheduled leg times).
 */
export function extractInterchanges(it: Itinerary): InterchangePoint[] {
  const out: InterchangePoint[] = [];
  const seen = new Set<string>();
  it.legs.forEach((leg, li) => {
    if (leg.mode !== 'RAIL') return;
    const all: Stop[] = [...leg.stops, leg.to];
    all.forEach((s, si) => {
      const prev = si === 0 ? leg.from : all[si - 1];
      const time = s.time ?? leg.startTime + ((leg.endTime - leg.startTime) * (si + 1)) / all.length;
      const known = findInterchange(s.name, s.code);
      const nextTransit = it.legs.slice(li + 1).find((l) => l.mode !== 'WALK');
      const isTransfer = si === all.length - 1 && nextTransit?.mode === 'RAIL' && nextTransit.route !== leg.route;
      if (!known && !isTransfer) return;
      const id = known?.id ?? normaliseStationName(s.name);
      if (seen.has(id)) return;
      seen.add(id);
      out.push({
        id,
        name: known?.name ?? s.name,
        lat: known?.lat ?? s.lat ?? 0,
        lng: known?.lng ?? s.lng ?? 0,
        offsetMs: time - it.startTime,
        currentLine: leg.route ?? '?',
        prevStation: prev.name,
      });
    });
  });
  return out;
}

export const etaOf = (trip: Trip, ic: InterchangePoint) => trip.startedAt + trip.anchorShiftMs + ic.offsetMs;

export const tripEndEta = (trip: Trip) => trip.startedAt + trip.anchorShiftMs + (trip.itinerary.endTime - trip.itinerary.startTime);

/** Re-anchor: "I'm at X now" shifts every later ETA by the observed drift. */
export function reanchor(trip: Trip, ic: InterchangePoint, now = Date.now()): Trip {
  return { ...trip, anchorShiftMs: now - (trip.startedAt + ic.offsetMs) };
}

export function railSummary(it: Itinerary): string[] {
  return it.legs.filter((l) => l.mode !== 'WALK').map((l) => (l.mode === 'BUS' ? `bus:${l.route}` : `rail:${l.route}`));
}
