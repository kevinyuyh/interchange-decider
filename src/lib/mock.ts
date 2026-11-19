// Demo data: lets the app run end to end with no keys. A fixed sample trip
// (Clementi → Ang Mo Kio via Buona Vista and Bishan) plus synthetic but
// time-consistent bus arrivals, so the verdicts move as the clock ticks.
import type { Api, RouteMode } from './api';
import { INTERCHANGES } from './network';
import { settingsStore } from './store';
import type { BusArrival, Itinerary, LatLng, Leg, Place, Stop } from './types';

const MIN = 60_000;

const ST = {
  clementi: { name: 'CLEMENTI MRT STATION', code: 'EW23', lat: 1.3151, lng: 103.7652 },
  dover: { name: 'DOVER MRT STATION', code: 'EW22', lat: 1.3114, lng: 103.7786 },
  buonaVista: { name: 'BUONA VISTA MRT STATION', code: 'EW21', lat: 1.3073, lng: 103.7901 },
  bvCC: { name: 'BUONA VISTA MRT STATION', code: 'CC22', lat: 1.3073, lng: 103.7901 },
  hollandV: { name: 'HOLLAND VILLAGE MRT STATION', code: 'CC21', lat: 1.3117, lng: 103.7961 },
  farrer: { name: 'FARRER ROAD MRT STATION', code: 'CC20', lat: 1.3172, lng: 103.8076 },
  botanic: { name: 'BOTANIC GARDENS MRT STATION', code: 'CC19', lat: 1.3224, lng: 103.8152 },
  caldecott: { name: 'CALDECOTT MRT STATION', code: 'CC17', lat: 1.3375, lng: 103.8395 },
  marymount: { name: 'MARYMOUNT MRT STATION', code: 'CC16', lat: 1.3487, lng: 103.8394 },
  bishanCC: { name: 'BISHAN MRT STATION', code: 'CC15', lat: 1.351, lng: 103.8485 },
  bishanNS: { name: 'BISHAN MRT STATION', code: 'NS17', lat: 1.351, lng: 103.8485 },
  amk: { name: 'ANG MO KIO MRT STATION', code: 'NS16', lat: 1.37, lng: 103.8495 },
};

export const DEMO_PLACES: Place[] = [
  { id: 'demo-a', name: 'Clementi Mall (demo)', address: '3155 Commonwealth Ave West', lat: 1.3149, lng: 103.7643 },
  { id: 'demo-b', name: 'AMK Hub (demo)', address: '53 Ang Mo Kio Ave 3', lat: 1.3692, lng: 103.8483 },
  { id: 'demo-c', name: 'Bishan Park (demo)', address: '1384 Ang Mo Kio Ave 1', lat: 1.3627, lng: 103.8446 },
];

function haversineKm(a: LatLng, b: LatLng) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

type S = { name: string; code?: string; lat: number; lng: number };
const stop = (s: S, time?: number): Stop => ({ ...s, time });

class Builder {
  legs: Leg[] = [];
  constructor(public t: number) {}
  walk(from: S, to: S, min: number) {
    this.legs.push({ mode: 'WALK', durationSec: min * 60, startTime: this.t, endTime: this.t + min * MIN, from: stop(from, this.t), to: stop(to, this.t + min * MIN), stops: [] });
    this.t += min * MIN;
    return this;
  }
  wait(min: number) {
    this.t += min * MIN;
    return this;
  }
  rail(line: string, path: S[], minPerHop = 2.3) {
    const start = this.t;
    const stops = path.slice(1, -1).map((s, i) => stop(s, start + (i + 1) * minPerHop * MIN));
    const dur = (path.length - 1) * minPerHop;
    this.legs.push({ mode: 'RAIL', route: line, durationSec: dur * 60, startTime: start, endTime: start + dur * MIN, from: stop(path[0], start), to: stop(path[path.length - 1], start + dur * MIN), stops });
    this.t += dur * MIN;
    return this;
  }
  bus(svc: string, from: S, to: S, min: number) {
    this.legs.push({ mode: 'BUS', route: svc, durationSec: min * 60, startTime: this.t, endTime: this.t + min * MIN, from: stop(from, this.t), to: stop(to, this.t + min * MIN), stops: [] });
    this.t += min * MIN;
    return this;
  }
  done(start: number): Itinerary {
    return { legs: this.legs, durationSec: (this.t - start) / 1000, startTime: start, endTime: this.t };
  }
}

const CC_BV_TO_BISHAN = [ST.bvCC, ST.hollandV, ST.farrer, ST.botanic, ST.caldecott, ST.marymount, ST.bishanCC];

function demoTrip(from: LatLng, to: LatLng, at: number): Itinerary[] {
  const origin = { name: 'Origin', ...from };
  const dest = { name: 'Destination', ...to };
  const a = new Builder(at)
    .walk(origin, ST.clementi, 3)
    .wait(1)
    .rail('EW', [ST.clementi, ST.dover, ST.buonaVista])
    .wait(4)
    .rail('CC', CC_BV_TO_BISHAN)
    .wait(3.5)
    .rail('NS', [ST.bishanNS, ST.amk], 2.5)
    .walk(ST.amk, dest, 5)
    .done(at);
  const b = new Builder(at)
    .walk(origin, { ...ST.clementi, name: 'Opp Clementi Stn', code: '17179' }, 4)
    .wait(5)
    .bus('52', { ...ST.clementi, name: 'Opp Clementi Stn', code: '17179' }, { ...ST.bishanNS, name: 'Bishan Int', code: '53009' }, 38)
    .walk(ST.bishanNS, dest, 9)
    .done(at);
  return [a, b];
}

/** X→B candidates for an interchange on the demo trip. */
function fromInterchange(x: (typeof INTERCHANGES)[number], to: LatLng, mode: RouteMode, at: number): Itinerary[] {
  const dest = { name: 'Destination', ...to };
  const xs = { name: `${x.name.toUpperCase()} MRT STATION`, lat: x.lat, lng: x.lng };
  const km = haversineKm(x, to);
  const out: Itinerary[] = [];

  if (mode !== 'BUS') {
    const b = new Builder(at);
    if (x.id === 'buona-vista') b.rail('CC', CC_BV_TO_BISHAN).rail('NS', [ST.bishanNS, ST.amk], 2.5);
    else if (x.id === 'botanic-gardens') b.rail('CC', [ST.botanic, ST.caldecott, ST.marymount, ST.bishanCC]).rail('NS', [ST.bishanNS, ST.amk], 2.5);
    else if (x.id === 'caldecott') b.rail('CC', [ST.caldecott, ST.marymount, ST.bishanCC]).rail('NS', [ST.bishanNS, ST.amk], 2.5);
    else if (x.id === 'bishan') b.rail('NS', [ST.bishanNS, ST.amk], 2.5);
    else b.rail('NS', [xs, ST.amk], Math.max(2, km * 1.7));
    b.walk(ST.amk, dest, 5);
    out.push(b.done(at));
  }
  if (mode !== 'RAIL') {
    const services: [string, number][] =
      x.id === 'buona-vista' ? [['74', 3], ['200', 5]] : x.id === 'bishan' ? [['166', 2], ['52', 4]] : x.id === 'caldecott' ? [['167', 4]] : [['132', 3], ['153', 5]];
    services.forEach(([svc, walkMin], i) => {
      const code = String(10000 + Math.floor(hash(x.id + svc) * 80000));
      const busStop = { name: `${x.name} Stn Exit ${String.fromCharCode(65 + i)}`, code, lat: x.lat + 0.001, lng: x.lng + 0.001 };
      const ride = Math.round(km * 2.1 + 2 + i * 2);
      out.push(new Builder(at).walk(xs, busStop, walkMin).bus(svc, busStop, { name: 'Near destination', lat: to.lat, lng: to.lng }, ride).walk(busStop, dest, 4).done(at));
    });
  }
  return out;
}

function demoArrivals(stopCode: string, svc: string, now: number): BusArrival[] {
  const h = 7 + Math.floor(hash(stopCode + svc) * 6); // 7–12 min headway
  const phase = hash(svc + stopCode) * h * MIN;
  const first = Math.ceil((now - phase) / (h * MIN)) * h * MIN + phase;
  return [0, 1, 2].map((k) => {
    const sched = first + k * h * MIN;
    const jitter = (hash(`${stopCode}${svc}${Math.round(sched / MIN)}`) - 0.5) * 3 * MIN; // ±1.5 min bunching
    return { etaMs: Math.round(sched + jitter), monitored: hash(`${svc}${k}${Math.round(sched / MIN)}`) > 0.25 };
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const mockApi: Api = {
  async search(q) {
    await sleep(150);
    const s = q.toLowerCase();
    return DEMO_PLACES.filter((p) => p.name.toLowerCase().includes(s) || p.address?.toLowerCase().includes(s) || s.length < 2);
  },
  async route(from, to, mode, at) {
    await sleep(250);
    const x = INTERCHANGES.find((i) => haversineKm(i, from) < 0.3);
    return x ? fromInterchange(x, to, mode, at) : demoTrip(from, to, at);
  },
  async busArrivals(stopCode) {
    await sleep(80);
    const now = Date.now();
    const services = ['74', '200', '166', '52', '167', '132', '153'];
    return Object.fromEntries(services.map((s) => [s, demoArrivals(stopCode, s, now)]));
  },
  async trainAlerts() {
    return settingsStore.get().demoDisruption
      ? [{ lines: ['CC'], message: 'CCL: No train service between Buona Vista and Bishan due to a track fault. Free bridging buses available.' }]
      : [];
  },
};
