# Interchange Decider

A browser-only PWA version of [docs/PRD.md](docs/PRD.md). When your train nears an MRT interchange, it compares the best rail option with the best bus option to your destination and shows a verdict like **"🚌 Bus wins 7/10"**.

There's no backend. Everything runs in the browser, and keys, places and the verdict log are kept in `localStorage`.

```bash
npm install
npm run dev        # http://localhost:5173 (also on your LAN via --host)
npm test           # engine + parser unit tests
npm run build      # static files in dist/
npm run data       # refresh the bundled stop/station snapshot
```

The app opens in **Demo mode**, which simulates a Clementi → AMK trip through four interchanges. Turn Demo mode off in Settings to use real data. Built-in routing is the default and needs no account.

## Routing options

| | Built-in (default) | OneMap |
|---|---|---|
| Account | None | Free OneMap account |
| Network data | Bundled snapshot `public/data/transit.json`: 184 MRT/LRT stations with line sequences ([cheeaun/sgraildata](https://github.com/cheeaun/sgraildata)), 5,209 bus stops and 604 services' stop sequences ([data.busrouter.sg](https://data.busrouter.sg)) | OneMap's own |
| Timing | No timetables: wait = headway / 2 from the Settings table; ride time from distance between stops; walking at 1.2 m/s × 1.3 detour | Scheduled leg times |
| Search | MRT/LRT stations and bus stops (name, road, stop code) | Any address or postal code |
| Works offline | Planning, yes (live buses still need a connection) | No |

The built-in router (`src/lib/router.ts`) runs Dijkstra over street, in-station and on-vehicle nodes. Penalties discourage needless transfers, and it re-runs with penalties on routes it has already used to find up to 3 alternatives. From an interchange it starts inside the station and knows your direction of travel, so staying on your train costs no wait. Either way, the verdict engine then re-simulates the candidates with live bus arrivals.

## Data sources

| Need | Source | Browser-direct? |
|---|---|---|
| Address search | OneMap Search | ✅ CORS, no token needed |
| Routes A→B, X→B | OneMap Routing (`RAIL` and `BUS` modes) | ✅ CORS. The token is fetched from your email/password and renewed automatically |
| Live bus arrivals | **arrivelah2.busrouter.sg** (default) | ✅ CORS, no key, includes the `monitored` flag |
| Live bus arrivals (alt) | LTA DataMall `v3/BusArrival` | ❌ no CORS |
| Train disruption alerts | LTA DataMall `TrainServiceAlerts` | ❌ no CORS |

DataMall blocks browsers, so its requests go to a configurable **forwarder base URL**:
- `npm run dev` and `npm run preview` provide `/datamall` through Vite's proxy, so alerts work locally once you add an AccountKey.
- On a static host (GitHub Pages, Netlify, …) there's no forwarder. Either point the setting at a CORS forwarder you control, or leave the key blank. The app then says alerts are off and never treats "no data" as "no disruption".

## Changes from the PRD (no-server build)

| PRD | Here |
|---|---|
| Next.js API routes hold the keys | Keys live in this browser only |
| Web push via VAPID + QStash at ETA − 2 min | The page shows a local notification through the service worker while the app is open. iOS needs the home-screen install. The trip screen is the primary UI, as the PRD intends |
| Passcode (D11) | Dropped: nothing is shared, and keys never leave the device except to OneMap/LTA |
| KV store | `localStorage` (single `userId: "me"` kept in every record) |
| Headways from `GTFSScheduleTrain` | Uses the D14 fallback: an editable per-line peak/off-peak/night table in Settings. GTFS still needs the day-1 inspection |

## Code map

- `src/lib/engine.ts`: pure Monte Carlo verdict engine (PRD §8), seedable and unit-tested
- `src/lib/verdict.ts`: OneMap X→B ×2, bus arrivals and alerts → engine → disruption override → log
- `src/lib/trip.ts`: finds the interchanges on an itinerary, computes ETAs and handles re-anchoring ("I'm here")
- `src/lib/router.ts`: built-in journey planner and station/stop search · `scripts/build-transit-data.mjs`: builds its data snapshot
- `src/lib/api.ts`: live clients · `src/lib/mock.ts`: demo data · `src/lib/network.ts`: lines, interchanges, default headways
- `src/ui/`: Trip, Places, Log and Settings screens
