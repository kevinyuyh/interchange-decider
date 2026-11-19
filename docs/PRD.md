# Interchange Decider: Product & Design Doc

_Status: agreed design, v1 · Last updated: 2026-11-19_

## 1. One-liner

A personal transit companion for Singapore. When your train pulls into an interchange, it tells you whether to **transfer to the next MRT line or switch to a bus**, using live bus data and a probabilistic model of the train, e.g. **"🚌 Bus wins 7/10"**.

## 2. Who it's for

**Me.** One iPhone user who rides MRT and buses across Singapore on trips that change from day to day. No other users in v1. The data model keeps a single `userId` so a few friends could be added later without a rewrite.

## 3. The problem

On the train, approaching an interchange, I have to decide whether to transfer to another MRT line or get off and take a bus for the last mile. Today:

- **The plan is stale.** Google Maps planned the route at A and never re-evaluates it mid-journey.
- **No side-by-side comparison.** Existing apps pick one route. None shows "next line vs best bus from *here*".
- **The next-line train time is unknowable.** From my train I can't see the other line's platform board, and no app shows it.

## 4. Why it needs to exist now

- **Live train data isn't coming.** On 13 Jan 2026 the Acting Transport Minister said in a parliamentary reply that LTA does not provide real-time train arrival data online, and gave no plan to change that (mot.gov.sg).
- **The unofficial routes are closed.** SMRT's train-arrival endpoints now return HTTP 403 and the scraped web page redirects elsewhere. The open-source projects that used them are dead.
- **So every app is lopsided:** buses are live, trains are a timetable. Google Maps, MyTransport.SG, SimplyGo, Apple Maps and the local bus apps all use schedules for MRT legs, and none re-ranks options at a transfer point. Google's LTA tie-up (Feb 2026) covers disruptions only.
- **The building blocks are new and free.** LTA DataMall added rail GTFS schedules in Apr 2026, and OneMap routing returns LTA stop codes that plug straight into the Bus Arrival API.

The gap won't close on its own. This app fills it honestly with probabilities instead of pretending to know the train time.

## 5. Product: how it works

1. **Start a trip** at A. Pick destination B from saved places (Home, Office, …) or OneMap address/postal-code search.
2. **Trip screen (always on).** For each upcoming interchange on the route:
   `~6 min to Bishan · 🚇 6:47 vs 🚌 6:42 · Bus wins 7/10`
   The screen refreshes itself, so it's current whenever I glance at it.
3. **Push** about 2 min before each interchange, carrying the verdict (works on iPhone once the app is installed to the home screen).
4. **Disruption.** If the line I'm on or the line I'd transfer to has an active alert, the rail option shows **"⚠️ Disrupted: <alert text>"**, no probability is shown, and the default is the bus.

### Scope

| v1 (in) | Later (out) |
|---|---|
| All MRT/LRT lines and all bus services | Getting off at a non-interchange station for a bus |
| Verdicts at every interchange on the route | Crowd/comfort as a tie-breaker (DataMall PCD) |
| Probabilistic verdict, "X wins N/10" | "Be there by HH:MM" deadline mode |
| Push about 2 min before an interchange | Learning walk times and bus ETA error from my own trips |
| Editable tables for walk times and headways | Modelling disruption delays from GTFS-RT |
| Logging every verdict for later accuracy checks | Multi-user sign-in |

## 6. Design decisions

| # | Decision | Choice | Why |
|---|---|---|---|
| D1 | Purpose | Personal tool, kept in use long-term | Real, recurring pain I can test every day |
| D2 | Coverage | Whole network | Data and APIs cost the same for 1 interchange or all |
| D3 | Output | Verdict on total time to B | A countdown alone doesn't settle the choice; arrival time at B does |
| D4 | Train uncertainty | Probabilistic, from scheduled headway; no manual input | Can't see the other line's board; headway at time *t* is knowable |
| D5 | What "better" means | P(option faster), shown as "N/10" | Readable in 2 seconds; honest about uncertainty |
| D6 | When it appears | Always-on trip screen + schedule-based ETA to the interchange | GPS is unreliable underground; no tracking needed |
| D7 | Platform | Installable mobile web app (PWA) with web push | No App Store; push works on iOS 16.4+ once installed |
| D8 | Stack | TypeScript end-to-end: Next.js + delayed-job service | One language for UI, API proxy and service worker |
| D9 | Bus uncertainty | Error band per ETA plus "can I reach the stop" logic | A "3 min" bus is useless if the stop is a 5 min walk |
| D10 | Disruptions | Warn, don't model; default to bus | Most trustworthy when data is least reliable |
| D11 | Users | Only me, behind a passcode | Protects API quota; no time spent on auth |
| D12 | Options compared | Every interchange: best rail vs best bus | Same logic everywhere; about 2 OneMap calls per interchange |
| D13 | Walk inside an interchange | 3 min default + per-interchange overrides, editable in-app | No official source exists; I know my stations |
| D14 | Headway source | DataMall `GTFSScheduleTrain`, falling back to the LTA train map; editable table | Official and uses the same key; fallback if the GTFS is synthetic or flat |

## 7. Data sources

| Source | Used for | Access | Notes |
|---|---|---|---|
| **LTA DataMall: Bus Arrival** | Next 3 buses per service at a stop, with `Monitored` flag | Free AccountKey (header) | Live. `Monitored=1` means GPS-based |
| **LTA DataMall: GTFSScheduleTrain** | Station-to-station run times; headways by line, direction and time | AccountKey; returns a zip link that expires in 15 min | Contents unverified until I have a key. **Check on day 1** |
| **LTA DataMall: Train Service Alerts** | Disruption flag and text | AccountKey | All MRT and LRT lines |
| **LTA train map** (lta.gov.sg) | Fallback headways (peak/off-peak), first/last train | Scrape once into a static table | Rough; goes stale without notice |
| **OneMap Routing** (`routeType=pt`) | Candidate routes A→B and X→B; leg durations; bus stop codes; MRT station codes | Free account → token valid 3 days | Static schedule (`realTime:false`). `mode=rail` / `mode=bus` / `transit`; `numItineraries` |
| **OneMap Search** | Turn an address or postal code into a location for B | Same token | |

DataMall returns at most 500 records per call (page with `$skip`).

## 8. The decision model

For an interchange **X**, reached at estimated time **t₀**, with destination **B**:

1. **Candidates.** Query OneMap X→B twice: `mode=rail` and bus-allowed (`mode=transit` or `bus`). Keep the top 2–3 routes from each.
2. **Monte Carlo** (about 1,000 samples per route). For each sample, build the total time to B:
   - **Rail legs:** `walk_transfer(X, line)` + wait ~ Uniform(0, `headway(line, dir, t)`) + ride time (from OneMap or GTFS). Further rail transfers repeat the same steps.
   - **Bus legs:** walk to the stop (OneMap WALK leg) = *w*. For each of the next 3 buses, true ETA = `EstimatedArrival` + ε, where ε ~ N(0, σ), with σ ≈ 1 min if `Monitored=1` and ≈ 3 min otherwise (tunable). Board the first bus whose sampled ETA ≥ *w*. If none qualifies, assume +1 scheduled headway. Then add ride time and any remaining legs.
   - Arrival time = t₀ + total.
3. **Score each route.** For each route, compute P(it's the fastest) across samples. Collapse to **best rail vs best bus**, and show `P(bus wins)` rounded to N/10 alongside the median arrival time of each.
4. **Override.** If there's an active alert on the current line or the transfer line, show the rail option as ⚠️ Disrupted with no probability, and recommend the bus.

ETA to each interchange (for the trip screen and the push) = trip start + OneMap scheduled leg times.

## 9. Architecture

```
iPhone PWA (Next.js, service worker for push)
   │  passcode session
   ▼
Next.js API routes (Vercel)
   ├─ /trip/start      → OneMap A→B, compute interchange ETAs, schedule pushes
   ├─ /trip/verdict    → OneMap X→B ×2 + Bus Arrival + alerts → Monte Carlo
   ├─ /push/fire       ← delayed-job callback at ETA − 2 min → verdict → web push (VAPID)
   ├─ /settings/*      → edit walk-time and headway tables, saved places
   └─ server-only secrets: DataMall AccountKey, OneMap credentials (auto-refresh 3-day token)
   ▼
KV store (e.g. Upstash Redis)
   push subscription · saved places · active trip · walk-time table ·
   headway table · verdict log
Delayed jobs (e.g. Upstash QStash): "call /push/fire at T"
```

## 10. Assumed defaults (not discussed, confirmed in the summary)

- Destination input: saved places + OneMap search.
- All keys and tokens stay server-side; the OneMap token refreshes automatically.
- Every verdict is logged (timestamp, inputs, P, chosen option) so I can later check whether "7/10" wins about 70% of the time.
- Stay within free tiers (Vercel, Upstash, DataMall, OneMap).

## 11. Risks & open questions

| Risk | Impact | Mitigation |
|---|---|---|
| `GTFSScheduleTrain` is synthetic or flat | Headway estimates are wrong | Inspect on day 1; fall back to the LTA map table |
| Estimated arrival at X drifts from reality (I left A later, or the train was slow) | Push fires early or late; t₀ is off | Show the ETA as approximate; the screen is always live; later: a quick "I'm at X" tap to re-anchor |
| OneMap rate limit isn't published | 429 errors at peak use | About 2 calls per interchange; cache A→B results for the trip |
| OneMap's gap between legs mixes walking and waiting | Double-counting the transfer | Use my own walk table, not OneMap gaps, for in-station transfers |
| iOS web push reliability | Missed alert | The trip screen is the primary UI; push is a bonus |
| Bus ETA error σ values are guesses | Over- or under-confident N/10 | Verdict log enables calibration later |

## 12. Next steps

1. Get a DataMall AccountKey and a OneMap account. Download `GTFSScheduleTrain` and inspect `stop_times` and `frequencies`.
2. Build the headway table (GTFS, or the LTA map fallback) and the walk-time table with a 3 min default.
3. Write the verdict engine (pure TS function plus unit tests) against fixed sample data from OneMap and Bus Arrival.
4. Build the API routes and trip screen; deploy behind a passcode.
5. Add the push flow (VAPID + QStash) and test on the iPhone home-screen install.
6. Use it daily for 2 weeks, then review the verdict log.
