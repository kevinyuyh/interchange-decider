import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildNetwork, planRoutes, searchNetwork, type TransitJson } from './router';
import type { Itinerary } from './types';

const net = buildNetwork(JSON.parse(readFileSync(new URL('../../public/data/transit.json', import.meta.url), 'utf8')) as TransitJson);
const opt = { railWaitSec: () => 150, busWaitSec: 300, walkTransferSec: () => 180 };
const AT = Date.UTC(2026, 10, 19, 2);
const show = (it: Itinerary) => `${Math.round(it.durationSec / 60)}m ` + it.legs.map((l) => (l.mode === 'WALK' ? `walk${Math.round(l.durationSec / 60)}` : `${l.route}[${l.from.code}→${l.to.code} ${Math.round(l.durationSec / 60)}m]`)).join(' ');

const CLEMENTI_MALL = { lat: 1.3149, lng: 103.7643 };
const AMK_HUB = { lat: 1.3692, lng: 103.8483 };

describe('built-in router', () => {
  it('plans a rail trip across the network', () => {
    const its = planRoutes(net, CLEMENTI_MALL, AMK_HUB, 'RAIL', AT, opt);
    its.forEach((i) => console.log('RAIL', show(i)));
    expect(its.length).toBeGreaterThan(0);
    const lines = its[0].legs.filter((l) => l.mode === 'RAIL').map((l) => l.route);
    expect(lines[0]).toBe('EW');
    expect(lines).toContain('NS');
    expect(its[0].durationSec / 60).toBeGreaterThan(25);
    expect(its[0].durationSec / 60).toBeLessThan(60);
  });

  it('plans transit with buses allowed', () => {
    const its = planRoutes(net, CLEMENTI_MALL, AMK_HUB, 'TRANSIT', AT, opt);
    its.forEach((i) => console.log('TRANSIT', show(i)));
    expect(its.length).toBe(3);
  });

  it('plans bus-only from inside an interchange', () => {
    const its = planRoutes(net, { lat: 1.351, lng: 103.8485 }, AMK_HUB, 'BUS', AT, opt, { stationName: 'Bishan', currentLine: 'CC', prevStation: 'Marymount' });
    its.forEach((i) => console.log('BUS from Bishan', show(i)));
    expect(its.length).toBeGreaterThan(0);
    expect(its[0].legs.some((l) => l.mode === 'BUS')).toBe(true);
    expect(its[0].legs.every((l) => l.mode !== 'RAIL')).toBe(true);
  });

  it('can stay on the current train from an interchange', () => {
    // On the NS line southbound at Bishan (came from Ang Mo Kio), heading to Orchard: stay on.
    const its = planRoutes(net, { lat: 1.351, lng: 103.8485 }, { lat: 1.3043, lng: 103.8322 }, 'RAIL', AT, opt, { stationName: 'Bishan', currentLine: 'NS', prevStation: 'Ang Mo Kio' });
    its.forEach((i) => console.log('STAY', show(i)));
    const first = its[0].legs.find((l) => l.mode === 'RAIL')!;
    expect(first.route).toBe('NS');
    expect(first.startTime).toBe(AT); // no wait: same train
  });

  it('searches stations and stops', () => {
    expect(searchNetwork(net, 'bishan')[0].name).toBe('Bishan station');
    expect(searchNetwork(net, '53009').length).toBeGreaterThan(0);
  });
});
