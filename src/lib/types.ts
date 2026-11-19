export const USER_ID = 'me'; // single user in v1; kept so more users can be added later

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Place extends LatLng {
  id: string;
  name: string;
  address?: string;
}

export type LegMode = 'WALK' | 'BUS' | 'RAIL';

export interface Stop {
  name: string;
  code?: string;
  time?: number; // scheduled arrival, epoch ms
  lat?: number;
  lng?: number;
}

export interface Leg {
  mode: LegMode;
  durationSec: number;
  startTime: number; // epoch ms (scheduled)
  endTime: number;
  /** Bus service number ("166") or rail line code ("NS", "CC", "BP"). */
  route?: string;
  from: Stop;
  to: Stop;
  /** Stops passed between from and to (rail legs). */
  stops: Stop[];
}

export interface Itinerary {
  legs: Leg[];
  durationSec: number;
  startTime: number;
  endTime: number;
}

export interface BusArrival {
  etaMs: number; // epoch ms
  monitored: boolean;
}

/** stopCode -> serviceNo -> next (up to 3) buses */
export type BusArrivals = Record<string, Record<string, BusArrival[]>>;

export interface TrainAlert {
  /** Short line codes affected, e.g. ["NS", "CC"]. */
  lines: string[];
  message: string;
}

export interface InterchangePoint {
  id: string; // interchange id from network table
  name: string;
  lat: number;
  lng: number;
  /** Offset from itinerary start, ms (scheduled). */
  offsetMs: number;
  /** Line the user is riding when arriving here. */
  currentLine: string;
  /** Station just before this one on that ride (gives the direction of travel). */
  prevStation?: string;
}

export interface Trip {
  id: string;
  userId: string;
  startedAt: number; // the moment the user tapped Start (anchor)
  anchorShiftMs: number; // re-anchor adjustment ("I'm at X")
  origin: Place;
  destination: Place;
  itinerary: Itinerary;
  interchanges: InterchangePoint[];
  arrivedAt?: number;
  /** Interchange ids already notified (so a reload doesn't re-fire). */
  notified?: string[];
}

export interface RouteSummary {
  id: string;
  kind: 'rail' | 'bus';
  label: string;
  medianArrival: number; // epoch ms
  p10: number;
  p90: number;
  pFastest: number;
  itinerary: Itinerary;
}

export interface Verdict {
  interchangeId: string;
  computedAt: number;
  t0: number;
  routes: RouteSummary[];
  bestRail?: RouteSummary;
  bestBus?: RouteSummary;
  /** P(best bus beats best rail). Undefined if one side is missing or rail is disrupted. */
  pBusWins?: number;
  disrupted?: { lines: string[]; message: string };
  recommendation: 'rail' | 'bus' | 'none';
  /** "Bus wins 7/10" etc. */
  headline: string;
  busArrivals: BusArrivals;
  error?: string;
}

export interface VerdictLogEntry {
  id: string; // `${tripId}:${interchangeId}`
  userId: string;
  tripId: string;
  interchangeId: string;
  interchangeName: string;
  firstAt: number;
  lastAt: number;
  refreshes: number;
  t0: number;
  pBusWins?: number;
  recommendation: Verdict['recommendation'];
  headline: string;
  rail?: { label: string; medianArrival: number; p10: number; p90: number };
  bus?: { label: string; medianArrival: number; p10: number; p90: number };
  disrupted?: string;
  busArrivals: BusArrivals;
  chosen?: 'rail' | 'bus';
  tripArrivedAt?: number;
}

export type Period = 'peak' | 'offpeak' | 'night';

export interface Settings {
  demo: boolean;
  /** Journey planning: OneMap API, or the built-in router over bundled stop data. */
  routing: 'onemap' | 'builtin';
  demoDisruption: boolean;
  datamallKey: string;
  onemapEmail: string;
  onemapPassword: string;
  onemapToken: string;
  onemapTokenExpiry: number; // epoch seconds
  /** Bus arrivals: arrivelah2.busrouter.sg (no key, CORS ok) or LTA DataMall. */
  busSource: 'arrivelah' | 'datamall';
  /** DataMall base URL (must be a CORS-enabled forwarder outside dev). Empty = alerts off. */
  datamallBase: string;
  samples: number;
  sigmaMonitoredMin: number;
  sigmaUnmonitoredMin: number;
  defaultBusHeadwayMin: number;
  defaultWalkMin: number;
  walkOverrides: Record<string, number>; // interchange id -> minutes
  headways: Record<string, Record<Period, number>>; // line -> period -> minutes
  notifyLeadMin: number;
}
