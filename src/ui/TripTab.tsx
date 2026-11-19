import { useCallback, useEffect, useRef, useState } from 'react';
import { getApi } from '../lib/api';
import { DEMO_PLACES } from '../lib/mock';
import { notificationPermission, requestNotifications, showNotification } from '../lib/notify';
import { logStore, settingsStore, tripHistoryStore, tripStore, uid } from '../lib/store';
import { etaOf, extractInterchanges, reanchor, tripEndEta } from '../lib/trip';
import { USER_ID, type InterchangePoint, type Itinerary, type Place, type Trip, type Verdict } from '../lib/types';
import { computeVerdict, recordArrival, recordChoice } from '../lib/verdict';
import { BusPill, LegChips, LinePill, PlacePicker, fmtMins, fmtTime, useNow } from './common';

const MIN = 60_000;
const LOOKAHEAD = 30 * MIN; // compute verdicts for interchanges this close

export function TripTab() {
  const trip = tripStore.use();
  return trip ? <ActiveTrip trip={trip} /> : <StartTrip />;
}

// ---------------------------------------------------------------- start

function StartTrip() {
  const settings = settingsStore.use();
  const [from, setFrom] = useState<Place | null>(settings.demo ? DEMO_PLACES[0] : null);
  const [to, setTo] = useState<Place | null>(settings.demo ? DEMO_PLACES[1] : null);
  const [options, setOptions] = useState<Itinerary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    setFrom(settings.demo ? DEMO_PLACES[0] : null);
    setTo(settings.demo ? DEMO_PLACES[1] : null);
    setOptions(null);
  }, [settings.demo]);

  const find = async () => {
    if (!from || !to) return;
    setBusy(true);
    setErr('');
    setOptions(null);
    try {
      const its = await getApi().route(from, to, 'TRANSIT', Date.now());
      if (!its.length) throw new Error('No routes found');
      setOptions(its);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const start = (it: Itinerary) => {
    const trip: Trip = {
      id: uid(),
      userId: USER_ID,
      startedAt: Date.now(),
      anchorShiftMs: 0,
      origin: from!,
      destination: to!,
      itinerary: it,
      interchanges: extractInterchanges(it),
    };
    tripStore.set(trip);
  };

  const placeholder = settings.demo || settings.routing === 'onemap' ? 'Search address or postal code' : 'Search MRT station or bus stop';

  return (
    <div className="stack">
      {settings.demo && (
        <div className="banner">
          <strong>Demo mode.</strong> Routes, buses and alerts are simulated. Turn it off in Settings to use live buses with built-in routing (no account needed) or OneMap.
        </div>
      )}
      <div className="card">
        <label className="label">From</label>
        <PlacePicker value={from} onPick={setFrom} placeholder={placeholder} allowCurrent />
      </div>
      <div className="card">
        <label className="label">To</label>
        <PlacePicker value={to} onPick={setTo} placeholder={placeholder} />
      </div>
      <button className="btn primary big" disabled={!from || !to || busy} onClick={find}>
        {busy ? 'Finding routes…' : 'Find routes'}
      </button>
      {err && <div className="error">{err}</div>}
      {options && (
        <div className="stack">
          <h2 className="h2">Pick your route</h2>
          {options.map((it, i) => {
            const ics = extractInterchanges(it);
            return (
              <button key={i} className="card option" onClick={() => start(it)}>
                <div className="row between">
                  <LegChips it={it} />
                  <strong>{Math.round(it.durationSec / 60)} min</strong>
                </div>
                <div className="muted small">
                  {ics.length ? `Interchanges: ${ics.map((c) => c.name).join(', ')}` : 'No MRT interchanges on this route, so there\'s nothing to decide'}
                </div>
                <div className="start-cta">Start trip ›</div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- active

type VState = Verdict & { loading?: boolean };

function ActiveTrip({ trip }: { trip: Trip }) {
  const now = useNow(5000);
  const settings = settingsStore.use();
  const [verdicts, setVerdicts] = useState<Record<string, VState>>({});
  const inflight = useRef(new Set<string>());
  const [perm, setPerm] = useState(notificationPermission());

  const upcoming = trip.interchanges.filter((ic) => etaOf(trip, ic) > now - MIN);
  const next = upcoming[0];

  const refresh = useCallback(
    async (ic: InterchangePoint) => {
      if (inflight.current.has(ic.id)) return;
      inflight.current.add(ic.id);
      setVerdicts((v) => ({ ...v, [ic.id]: { ...(v[ic.id] ?? ({} as VState)), loading: true } }));
      try {
        const latest = tripStore.get() ?? trip;
        const v = await computeVerdict(latest, ic);
        setVerdicts((s) => ({ ...s, [ic.id]: v }));
        return v;
      } finally {
        inflight.current.delete(ic.id);
      }
    },
    [trip],
  );

  // Auto-refresh: next interchange every 60 s, others within 30 min every 3 min.
  useEffect(() => {
    for (const ic of upcoming) {
      const eta = etaOf(trip, ic);
      if (eta - now > LOOKAHEAD) continue;
      const v = verdicts[ic.id];
      const maxAge = ic === next ? 60_000 : 180_000;
      if (!v || (!v.loading && now - v.computedAt > maxAge)) refresh(ic);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, trip.anchorShiftMs]);

  // Local notification ~lead min before each interchange (no push server).
  useEffect(() => {
    if (perm !== 'granted') return;
    for (const ic of upcoming) {
      const eta = etaOf(trip, ic);
      if (trip.notified?.includes(ic.id)) continue;
      if (now >= eta - settings.notifyLeadMin * MIN && now < eta) {
        tripStore.set({ ...trip, notified: [...(trip.notified ?? []), ic.id] });
        refresh(ic).then((v) => {
          if (!v) return;
          const times = v.disrupted ? `⚠️ ${v.disrupted.message}` : v.bestRail && v.bestBus ? `🚇 ${fmtTime(v.bestRail.medianArrival)} vs 🚌 ${fmtTime(v.bestBus.medianArrival)}` : '';
          showNotification(`${ic.name} in ~${fmtMins(eta - Date.now())}: ${v.headline}`, times, `ic-${trip.id}-${ic.id}`);
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, perm]);

  const end = (arrived: boolean) => {
    const at = Date.now();
    if (arrived) recordArrival(trip.id, at);
    tripHistoryStore.set((h) => [{ ...trip, arrivedAt: arrived ? at : undefined }, ...h].slice(0, 100));
    tripStore.set(null);
  };

  const imHere = (ic: InterchangePoint) => {
    const t = reanchor(trip, ic);
    tripStore.set(t);
    setVerdicts((v) => {
      const copy = { ...v };
      for (const k of Object.keys(copy)) copy[k] = { ...copy[k], computedAt: copy[k].computedAt - 3600_000 }; // mark stale -> refresh
      return copy;
    });
  };

  const enableNotifs = async () => setPerm(await requestNotifications());

  return (
    <div className="stack">
      <div className="card trip-head">
        <div className="row between">
          <div>
            <div className="muted small">To</div>
            <div className="h2">{trip.destination.name}</div>
          </div>
          <div className="right">
            <div className="muted small">Scheduled arrival</div>
            <div className="h2">~{fmtTime(tripEndEta(trip))}</div>
          </div>
        </div>
        <div className="row gap wrap">
          <LegChips it={trip.itinerary} />
        </div>
        <div className="row gap wrap">
          {perm === 'default' && (
            <button className="btn small" onClick={enableNotifs}>
              🔔 Alert me {settings.notifyLeadMin} min before
            </button>
          )}
          {perm === 'granted' && <span className="muted small">🔔 Alerts on (while the app is open)</span>}
          {perm === 'denied' && <span className="muted small">🔕 Notifications blocked</span>}
          {perm === 'unsupported' && <span className="muted small">🔕 Add to Home Screen for alerts</span>}
          <span className="spacer" />
          <button className="btn small" onClick={() => end(true)}>
            Arrived
          </button>
          <button className="btn small ghost" onClick={() => end(false)}>
            End
          </button>
        </div>
      </div>

      {!settings.demo && !settings.datamallKey && (
        <div className="banner subtle">Disruption alerts are off. Add a DataMall AccountKey in Settings to turn them on.</div>
      )}
      {Object.values(verdicts).some((v) => v.error === 'alerts-unavailable') && settings.datamallKey && (
        <div className="banner subtle">Couldn't reach DataMall for disruption alerts. Check the forwarder URL in Settings.</div>
      )}

      {trip.interchanges.length === 0 && <div className="card muted">This route has no MRT interchanges, so there's nothing to decide. Enjoy the ride.</div>}

      {trip.interchanges.map((ic) => (
        <InterchangeCard
          key={ic.id}
          trip={trip}
          ic={ic}
          now={now}
          isNext={ic === next}
          verdict={verdicts[ic.id]}
          onRefresh={() => refresh(ic)}
          onHere={() => imHere(ic)}
        />
      ))}
    </div>
  );
}

function InterchangeCard({ trip, ic, now, isNext, verdict, onRefresh, onHere }: { trip: Trip; ic: InterchangePoint; now: number; isNext: boolean; verdict?: VState; onRefresh: () => void; onHere: () => void }) {
  const eta = etaOf(trip, ic);
  const passed = eta < now - MIN;
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<'rail' | 'bus' | undefined>(() => logStore.get().find((e) => e.id === `${trip.id}:${ic.id}`)?.chosen);
  const far = eta - now > LOOKAHEAD;

  const choose = (c: 'rail' | 'bus') => {
    setChosen(c);
    recordChoice(trip.id, ic.id, c);
  };

  const v = verdict;
  const hasResult = !!v && v.routes?.length > 0;
  const tone = v?.disrupted ? 'warn' : v?.recommendation === 'bus' ? 'bus' : v?.recommendation === 'rail' ? 'rail' : '';

  return (
    <div className={`card ic ${passed ? 'passed' : ''} ${isNext ? 'next' : ''}`}>
      <div className="row between">
        <div className="ic-title">
          <LinePill line={ic.currentLine} />
          <span className="ic-name">{ic.name}</span>
        </div>
        <div className="right">
          <div className="eta">{passed ? 'passed' : `~${fmtMins(eta - now)}`}</div>
          <div className="muted small">{fmtTime(eta)}</div>
        </div>
      </div>

      {passed ? null : far && !hasResult ? (
        <div className="muted small">Verdict appears about 30 min before you get here.</div>
      ) : !v || (v.loading && !hasResult) ? (
        <div className="muted small">Working out the odds…</div>
      ) : v.error && !hasResult ? (
        <div className="error small">
          {v.error}{' '}
          <button className="link" onClick={onRefresh}>
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="versus">
            <div className={`opt ${v.disrupted ? 'bad' : ''}`}>
              <span className="emoji">🚇</span>
              {v.disrupted ? <span className="warn-text">⚠️ Disrupted</span> : <span className="t">{v.bestRail ? fmtTime(v.bestRail.medianArrival) : '—'}</span>}
            </div>
            <span className="vs">vs</span>
            <div className="opt">
              <span className="emoji">🚌</span>
              <span className="t">{v.bestBus ? fmtTime(v.bestBus.medianArrival) : '—'}</span>
            </div>
          </div>
          <div className={`verdict ${tone}`}>{v.headline}</div>
          {v.disrupted && <div className="warn-box small">⚠️ Disrupted: {v.disrupted.message}</div>}

          <div className="row gap wrap actions">
            {!passed && (
              <button className="btn small" onClick={onHere} title="Re-anchor all ETAs to now">
                📍 I'm here
              </button>
            )}
            <button className={`btn small ${chosen === 'rail' ? 'on' : ''}`} onClick={() => choose('rail')}>
              Took 🚇
            </button>
            <button className={`btn small ${chosen === 'bus' ? 'on' : ''}`} onClick={() => choose('bus')}>
              Took 🚌
            </button>
            <span className="spacer" />
            <button className="link small" onClick={() => setOpen(!open)}>
              {open ? 'Less' : 'Details'}
            </button>
          </div>

          {open && (
            <div className="details">
              <table className="routes">
                <thead>
                  <tr>
                    <th>Route</th>
                    <th>Arrive (10–90%)</th>
                    <th>Fastest</th>
                  </tr>
                </thead>
                <tbody>
                  {v.routes.map((r) => (
                    <tr key={r.id} className={r === v.bestRail || r === v.bestBus || r.id === v.bestRail?.id || r.id === v.bestBus?.id ? 'best' : ''}>
                      <td>
                        <LegChips it={r.itinerary} />
                      </td>
                      <td>
                        <strong>{fmtTime(r.medianArrival)}</strong>{' '}
                        <span className="muted small">
                          {fmtTime(r.p10)}–{fmtTime(r.p90)}
                        </span>
                      </td>
                      <td>{Math.round(r.pFastest * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <BusBoard v={v} />
              <div className="muted small">
                Updated {fmtMins(now - v.computedAt) === 'now' ? 'just now' : `${fmtMins(now - v.computedAt)} ago`}
                {v.pBusWins !== undefined && ` · P(bus wins) = ${(v.pBusWins * 100).toFixed(0)}%`} ·{' '}
                <button className="link small" onClick={onRefresh} disabled={v.loading}>
                  {v.loading ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BusBoard({ v }: { v: Verdict }) {
  const rows: { stop: string; name: string; svc: string; buses: { etaMs: number; monitored: boolean }[] }[] = [];
  const seen = new Set<string>();
  for (const r of v.routes) {
    for (const l of r.itinerary.legs) {
      if (l.mode !== 'BUS' || !l.from.code || !l.route) continue;
      const k = `${l.from.code}:${l.route}`;
      if (seen.has(k)) continue;
      seen.add(k);
      rows.push({ stop: l.from.code, name: l.from.name, svc: l.route, buses: v.busArrivals[l.from.code]?.[l.route] ?? [] });
    }
  }
  if (!rows.length) return null;
  return (
    <div className="busboard">
      <div className="label">Live buses used</div>
      {rows.map((r) => (
        <div key={r.stop + r.svc} className="row gap">
          <BusPill svc={r.svc} />
          <span className="muted small grow">
            {r.name} ({r.stop})
          </span>
          <span className="small">
            {r.buses.length
              ? r.buses.map((b, i) => (
                  <span key={i} className={b.monitored ? '' : 'sched'} title={b.monitored ? 'GPS-tracked' : 'Scheduled (not GPS-tracked)'}>
                    {i > 0 && ', '}
                    {fmtMins(b.etaMs - v.computedAt)}
                  </span>
                ))
              : 'no data'}
          </span>
        </div>
      ))}
      <div className="muted tiny">Italic = scheduled, not GPS-tracked (wider error band).</div>
    </div>
  );
}
