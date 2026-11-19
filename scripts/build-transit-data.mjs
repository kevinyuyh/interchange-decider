// Builds public/data/transit.json: every MRT/LRT station (with line sequences)
// and every bus stop + service stop sequence. The app's built-in router uses
// this snapshot so it needs no routing API. Re-run to refresh:
//   npm run data
import { mkdir, writeFile } from 'node:fs/promises';

const SOURCES = {
  rail: 'https://raw.githubusercontent.com/cheeaun/sgraildata/master/data/v1/sg-rail.geojson',
  stops: 'https://data.busrouter.sg/v1/stops.min.json',
  services: 'https://data.busrouter.sg/v1/services.min.json',
};

const get = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
};

const round = (n) => Math.round(n * 1e6) / 1e6;

const [rail, stops, services] = await Promise.all([get(SOURCES.rail), get(SOURCES.stops), get(SOURCES.services)]);

// ---- rail stations ----
const stations = rail.features
  .filter((f) => f.properties.stop_type === 'station' && f.geometry.type === 'Point')
  .map((f) => ({ n: f.properties.name, c: f.properties.station_codes.split('-'), y: round(f.geometry.coordinates[1]), x: round(f.geometry.coordinates[0]) }))
  .sort((a, b) => a.n.localeCompare(b.n));
const byCode = new Map();
stations.forEach((s, i) => s.c.forEach((c) => byCode.set(c, i)));

const parse = (code) => {
  const m = code.match(/^([A-Z]+)(\d*)$/);
  return { prefix: m[1], num: Number(m[2] || 0) };
};
const seqOf = (prefix) =>
  [...byCode.keys()]
    .filter((c) => parse(c).prefix === prefix && parse(c).num > 0)
    .sort((a, b) => parse(a).num - parse(b).num);

// Line sequences (each is run in both directions by the router).
const railSeqs = [];
const add = (line, codes) => {
  const s = codes.map((c) => {
    if (!byCode.has(c)) throw new Error(`missing station ${c}`);
    return byCode.get(c);
  });
  if (s.length > 1) railSeqs.push({ l: line, s });
};
for (const line of ['NS', 'EW', 'NE', 'DT', 'TE']) add(line, seqOf(line));
// Circle Line: Dhoby Ghaut → … → HarbourFront → Keppel → … → Marina Bay → Bayfront,
// plus the Bayfront–Promenade link that closes the circle.
add('CC', seqOf('CC'));
if (byCode.has('CC34') && byCode.has('CC4')) add('CC', ['CC34', 'CC4']);
// Changi Airport branch: Tanah Merah (code "CG") → Expo → Changi Airport.
add('CG', ['CG', ...seqOf('CG')]);
// Bukit Panjang LRT: CCK → Bukit Panjang, then the loop back to Bukit Panjang.
add('BP', [...seqOf('BP'), 'BP6']);
// Sengkang / Punggol LRT loops from their hubs.
add('SK', ['STC', ...seqOf('SE'), 'STC']);
add('SK', ['STC', ...seqOf('SW'), 'STC']);
add('PG', ['PTC', ...seqOf('PE'), 'PTC']);
add('PG', ['PTC', ...seqOf('PW'), 'PTC']);

// ---- buses ----
const stopCodes = Object.keys(stops).sort();
const stopIdx = new Map(stopCodes.map((c, i) => [c, i]));
const busStops = stopCodes.map((c) => {
  const [lng, lat, name, road] = stops[c];
  return [c, name, road, round(lat), round(lng)];
});
const busServices = Object.entries(services)
  .map(([no, svc]) => [no, svc.routes.map((r) => r.map((c) => stopIdx.get(c)).filter((i) => i !== undefined)).filter((r) => r.length > 1)])
  .filter(([, routes]) => routes.length);

const out = {
  generatedAt: new Date().toISOString(),
  sources: Object.values(SOURCES),
  stations,
  rail: railSeqs,
  stops: busStops,
  services: busServices,
};
await mkdir(new URL('../public/data/', import.meta.url), { recursive: true });
await writeFile(new URL('../public/data/transit.json', import.meta.url), JSON.stringify(out));
console.log(`stations ${stations.length}, rail sequences ${railSeqs.length}, bus stops ${busStops.length}, services ${busServices.length}`);
