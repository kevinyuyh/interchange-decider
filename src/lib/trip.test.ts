import { describe, expect, it } from 'vitest';
import { parseOneMapItineraries, parseTrainAlerts } from './api';
import { mockApi, DEMO_PLACES } from './mock';
import { extractInterchanges } from './trip';

describe('extractInterchanges', () => {
  it('finds every interchange on the demo trip with the line being ridden', async () => {
    const [it0] = await mockApi.route(DEMO_PLACES[0], DEMO_PLACES[1], 'TRANSIT', Date.UTC(2026, 10, 19, 2));
    const ics = extractInterchanges(it0);
    expect(ics.map((i) => [i.id, i.currentLine])).toEqual([
      ['buona-vista', 'EW'],
      ['botanic-gardens', 'CC'],
      ['caldecott', 'CC'],
      ['bishan', 'CC'],
    ]);
    expect(ics[0].offsetMs).toBeGreaterThan(0);
    expect(ics[3].offsetMs).toBeGreaterThan(ics[2].offsetMs);
  });
});

describe('parsers', () => {
  it('parses a OneMap itinerary', () => {
    const its = parseOneMapItineraries({
      plan: {
        itineraries: [
          {
            duration: 900, startTime: 1000, endTime: 901000,
            legs: [
              { mode: 'SUBWAY', route: 'NS', duration: 300, startTime: 1000, endTime: 301000, from: { name: 'BISHAN MRT STATION', stopCode: 'NS17' }, to: { name: 'ANG MO KIO MRT STATION', stopCode: 'NS16' }, intermediateStops: [] },
              { mode: 'BUS', route: '166', duration: 600, startTime: 301000, endTime: 901000, from: { name: 'AMK Int', stopCode: '54009' }, to: { name: 'X', stopCode: '1' } },
            ],
          },
        ],
      },
    });
    expect(its[0].legs[0]).toMatchObject({ mode: 'RAIL', route: 'NS' });
    expect(its[0].legs[1]).toMatchObject({ mode: 'BUS', route: '166', from: { code: '54009' } });
  });

  it('parses DataMall train alerts', () => {
    expect(parseTrainAlerts({ value: { Status: 1, AffectedSegments: [], Message: [] } })).toEqual([]);
    const a = parseTrainAlerts({ value: { Status: 2, AffectedSegments: [{ Line: 'CCL', Stations: 'CC15,CC16' }], Message: [{ Content: 'CCL: delay of 20 min' }] } });
    expect(a).toEqual([{ lines: ['CC'], message: 'CCL: delay of 20 min' }]);
  });
});
