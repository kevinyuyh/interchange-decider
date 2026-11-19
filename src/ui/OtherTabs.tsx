import { useState } from 'react';
import { getApi } from '../lib/api';
import { loadNetwork } from '../lib/router';
import { INTERCHANGES, LINES } from '../lib/network';
import { DEFAULT_SETTINGS, logStore, placesStore, settingsStore, uid } from '../lib/store';
import type { Period, Place, VerdictLogEntry } from '../lib/types';
import { NumberField, PlacePicker, Section, fmtDateTime, fmtTime } from './common';

// ---------------------------------------------------------------- places

export function PlacesTab() {
  const places = placesStore.use();
  const [name, setName] = useState('');
  const [loc, setLoc] = useState<Place | null>(null);

  const add = () => {
    if (!loc) return;
    placesStore.set([...places, { ...loc, id: uid(), name: name.trim() || loc.name, address: loc.address ?? loc.name }]);
    setName('');
    setLoc(null);
  };

  return (
    <div className="stack">
      <Section title="Saved places">
        {places.length === 0 && <div className="muted">None yet. Add Home, Office and so on below.</div>}
        <ul className="list">
          {places.map((p) => (
            <li key={p.id} className="row between">
              <div>
                <strong>{p.name}</strong>
                <div className="muted small">{p.address ?? `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`}</div>
              </div>
              <button className="btn small ghost" onClick={() => placesStore.set(places.filter((x) => x.id !== p.id))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Add a place">
        <input className="input" placeholder="Name (e.g. Home)" value={name} onChange={(e) => setName(e.target.value)} />
        <PlacePicker value={loc} onPick={setLoc} placeholder="Search" allowCurrent />
        <button className="btn primary" disabled={!loc} onClick={add}>
          Save place
        </button>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- log

function download(name: string, text: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function toCsv(log: VerdictLogEntry[]) {
  const cols = ['lastAt', 'tripId', 'interchangeName', 't0', 'pBusWins', 'recommendation', 'railMedian', 'busMedian', 'disrupted', 'chosen', 'tripArrivedAt', 'refreshes'];
  const iso = (t?: number) => (t ? new Date(t).toISOString() : '');
  const rows = log.map((e) =>
    [iso(e.lastAt), e.tripId, e.interchangeName, iso(e.t0), e.pBusWins ?? '', e.recommendation, iso(e.rail?.medianArrival), iso(e.bus?.medianArrival), e.disrupted ?? '', e.chosen ?? '', iso(e.tripArrivedAt), e.refreshes]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(','),
  );
  return [cols.join(','), ...rows].join('\n');
}

export function LogTab() {
  const log = logStore.use();
  const withChoice = log.filter((e) => e.chosen).length;
  const followed = log.filter((e) => e.chosen && e.chosen === e.recommendation).length;

  return (
    <div className="stack">
      <Section
        title="Verdict log"
        aside={
          <div className="row gap">
            <button className="btn small" disabled={!log.length} onClick={() => download('verdicts.csv', toCsv(log), 'text/csv')}>
              CSV
            </button>
            <button className="btn small" disabled={!log.length} onClick={() => download('verdicts.json', JSON.stringify(log, null, 2), 'application/json')}>
              JSON
            </button>
          </div>
        }
      >
        <div className="muted small">
          One row per interchange per trip, holding the last verdict before you reached it. {log.length} logged · {withChoice} with your choice
          {withChoice > 0 && ` · you followed the verdict ${followed}/${withChoice} times`}.
        </div>
        {log.length === 0 && <div className="muted">Verdicts appear here once you start a trip.</div>}
        <ul className="list">
          {log.map((e) => (
            <li key={e.id}>
              <div className="row between">
                <strong>{e.interchangeName}</strong>
                <span className="muted small">{fmtDateTime(e.t0)}</span>
              </div>
              <div className="row between small">
                <span>{e.headline}</span>
                <span className="muted">
                  🚇 {e.rail ? fmtTime(e.rail.medianArrival) : '—'} · 🚌 {e.bus ? fmtTime(e.bus.medianArrival) : '—'}
                </span>
              </div>
              <div className="muted tiny">
                {e.chosen ? `Took ${e.chosen === 'bus' ? '🚌' : '🚇'}` : 'No choice recorded'}
                {e.tripArrivedAt && ` · arrived ${fmtTime(e.tripArrivedAt)}`}
                {e.disrupted && ' · ⚠️ disrupted'} · {e.refreshes} refreshes
              </div>
            </li>
          ))}
        </ul>
        {log.length > 0 && (
          <button
            className="btn small ghost danger"
            onClick={() => {
              if (confirm(`Delete all ${log.length} log entries? This can't be undone. Export first if you want to keep them.`)) logStore.set([]);
            }}
          >
            Clear log
          </button>
        )}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- settings

const PERIODS: { key: Period; label: string }[] = [
  { key: 'peak', label: 'Peak' },
  { key: 'offpeak', label: 'Off-peak' },
  { key: 'night', label: 'Night' },
];

export function SettingsTab() {
  const s = settingsStore.use();
  const set = settingsStore.patch;
  const [test, setTest] = useState<Record<string, string>>({});

  const run = async (key: string, fn: () => Promise<string>) => {
    setTest((t) => ({ ...t, [key]: 'Testing…' }));
    try {
      const msg = await fn();
      setTest((t) => ({ ...t, [key]: `✅ ${msg}` }));
    } catch (e) {
      setTest((t) => ({ ...t, [key]: `❌ ${(e as Error).message}` }));
    }
  };

  const tokenInfo = s.onemapTokenExpiry ? `Token valid until ${fmtDateTime(s.onemapTokenExpiry * 1000)}` : s.onemapToken ? 'Token set (expiry unknown)' : 'No token yet';

  return (
    <div className="stack">
      <Section title="Data">
        <label className="toggle">
          <input type="checkbox" checked={s.demo} onChange={(e) => set({ demo: e.target.checked })} />
          <span>
            <strong>Demo mode</strong>
            <span className="muted small"> Simulated routes, buses and alerts. No keys needed.</span>
          </span>
        </label>
        {s.demo && (
          <label className="toggle">
            <input type="checkbox" checked={s.demoDisruption} onChange={(e) => set({ demoDisruption: e.target.checked })} />
            <span>
              Simulate a Circle Line disruption
            </span>
          </label>
        )}
        <div className="muted small">Keys and passwords are stored only in this browser (localStorage) and sent only to OneMap / LTA.</div>
      </Section>

      <Section title="Routing">
        <label className="toggle">
          <input type="radio" name="routing" checked={s.routing === 'builtin'} onChange={() => set({ routing: 'builtin' })} />
          <span>
            <strong>Built-in</strong>
            <span className="muted small"> No account. Plans on-device over every MRT/LRT station and bus route (bundled snapshot). Uses average headways and estimated ride times, not timetables. Search finds stations and bus stops, not street addresses.</span>
          </span>
        </label>
        <label className="toggle">
          <input type="radio" name="routing" checked={s.routing === 'onemap'} onChange={() => set({ routing: 'onemap' })} />
          <span>
            <strong>OneMap</strong>
            <span className="muted small"> Official scheduled routing and full address/postal-code search. Needs a free OneMap account.</span>
          </span>
        </label>
        <div className="row between">
          <span className="muted small">{test.data ?? ''}</span>
          <button
            className="btn small"
            onClick={() =>
              run('data', async () => {
                const net = await loadNetwork();
                return `${net.R} stations, ${net.N - net.R} bus stops, ${new Set(net.patterns.filter((p) => p.kind === 'bus').map((p) => p.route)).size} bus services · snapshot ${net.generatedAt.slice(0, 10)}`;
              })
            }
          >
            Check data
          </button>
        </div>
      </Section>

      <Section title="OneMap account">
        <div className="muted small">Only needed for OneMap routing. Free account from onemap.gov.sg. The 3-day token is fetched and renewed automatically.</div>
        <input className="input" placeholder="OneMap email" autoComplete="username" value={s.onemapEmail} onChange={(e) => set({ onemapEmail: e.target.value })} />
        <input className="input" type="password" placeholder="OneMap password" autoComplete="current-password" value={s.onemapPassword} onChange={(e) => set({ onemapPassword: e.target.value, onemapToken: '', onemapTokenExpiry: 0 })} />
        <details>
          <summary className="small">…or paste a token</summary>
          <input className="input" placeholder="OneMap access token" value={s.onemapToken} onChange={(e) => set({ onemapToken: e.target.value.trim(), onemapTokenExpiry: 0 })} />
        </details>
        <div className="row between">
          <span className="muted small">{tokenInfo}</span>
          <button
            className="btn small"
            disabled={s.demo}
            onClick={() =>
              run('onemap', async () => {
                const its = await getApi().route({ lat: 1.351, lng: 103.8485 }, { lat: 1.3692, lng: 103.8483 }, 'TRANSIT', Date.now());
                return `Routing OK (${its.length} routes Bishan → AMK)`;
              })
            }
          >
            Test
          </button>
        </div>
        {test.onemap && <div className="small">{test.onemap}</div>}
      </Section>

      <Section title="Bus arrivals">
        <label className="toggle">
          <input type="radio" name="bus" checked={s.busSource === 'arrivelah'} onChange={() => set({ busSource: 'arrivelah' })} />
          <span>
            <strong>arrivelah (busrouter.sg)</strong>
            <span className="muted small"> No key, works from any static host. Unofficial mirror of LTA data.</span>
          </span>
        </label>
        <label className="toggle">
          <input type="radio" name="bus" checked={s.busSource === 'datamall'} onChange={() => set({ busSource: 'datamall' })} />
          <span>
            <strong>LTA DataMall</strong>
            <span className="muted small"> Official, needs the AccountKey and forwarder below.</span>
          </span>
        </label>
        <div className="row between">
          <span />
          <button
            className="btn small"
            disabled={s.demo}
            onClick={() =>
              run('bus', async () => {
                const r = await getApi().busArrivals('53009');
                return `${Object.keys(r).length} services at Bishan Int (53009)`;
              })
            }
          >
            Test
          </button>
        </div>
        {test.bus && <div className="small">{test.bus}</div>}
      </Section>

      <Section title="LTA DataMall (disruption alerts)">
        <div className="muted small">
          DataMall blocks direct browser calls (no CORS). The forwarder URL defaults to <code>/datamall</code>, which <code>npm run dev</code> / <code>preview</code> provide. On a static host, point it at your own CORS forwarder or leave the key blank to turn alerts off.
        </div>
        <input className="input" placeholder="AccountKey" value={s.datamallKey} onChange={(e) => set({ datamallKey: e.target.value.trim() })} />
        <input className="input" placeholder="Forwarder base URL" value={s.datamallBase} onChange={(e) => set({ datamallBase: e.target.value.trim() })} />
        <div className="row between">
          <span />
          <button
            className="btn small"
            disabled={s.demo}
            onClick={() =>
              run('alerts', async () => {
                const a = await getApi().trainAlerts();
                if (a === null) throw new Error('Unavailable (check key / forwarder)');
                return a.length ? `${a.length} active: ${a.map((x) => x.lines.join('/')).join(', ')}` : 'Reached DataMall: no disruptions right now';
              })
            }
          >
            Test
          </button>
        </div>
        {test.alerts && <div className="small">{test.alerts}</div>}
      </Section>

      <Section title="Model">
        <div className="grid2">
          <label>Samples per route</label>
          <NumberField value={s.samples} step={100} min={100} onChange={(v) => set({ samples: v ?? DEFAULT_SETTINGS.samples })} />
          <label>Bus σ, GPS-tracked</label>
          <NumberField value={s.sigmaMonitoredMin} step={0.25} onChange={(v) => set({ sigmaMonitoredMin: v ?? 1 })} suffix="min" />
          <label>Bus σ, scheduled</label>
          <NumberField value={s.sigmaUnmonitoredMin} step={0.25} onChange={(v) => set({ sigmaUnmonitoredMin: v ?? 3 })} suffix="min" />
          <label>Bus headway if unknown</label>
          <NumberField value={s.defaultBusHeadwayMin} step={1} onChange={(v) => set({ defaultBusHeadwayMin: v ?? 10 })} suffix="min" />
          <label>Alert before interchange</label>
          <NumberField value={s.notifyLeadMin} step={0.5} onChange={(v) => set({ notifyLeadMin: v ?? 2 })} suffix="min" />
        </div>
      </Section>

      <Section title="Walk times inside interchanges">
        <div className="muted small">Platform to platform. Blank uses the default.</div>
        <div className="grid2">
          <label>
            <strong>Default</strong>
          </label>
          <NumberField value={s.defaultWalkMin} onChange={(v) => set({ defaultWalkMin: v ?? 3 })} suffix="min" />
          {INTERCHANGES.map((ic) => (
            <WalkRow key={ic.id} id={ic.id} name={ic.name} codes={ic.codes.join(' / ')} value={s.walkOverrides[ic.id]} placeholder={String(s.defaultWalkMin)} />
          ))}
        </div>
      </Section>

      <Section title="Train headways" aside={<button className="link small" onClick={() => set({ headways: DEFAULT_SETTINGS.headways })}>Reset</button>}>
        <div className="muted small">Minutes between trains. Peak = weekdays 7:00–9:30 and 17:00–20:00; night = 22:30–6:30. Defaults are rough values from LTA's published ranges.</div>
        <table className="headways">
          <thead>
            <tr>
              <th>Line</th>
              {PERIODS.map((p) => (
                <th key={p.key}>{p.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LINES.map((l) => (
              <tr key={l.code}>
                <td>
                  <span className="pill" style={{ background: l.color }}>
                    {l.code}
                  </span>
                </td>
                {PERIODS.map((p) => (
                  <td key={p.key}>
                    <NumberField
                      value={s.headways[l.code]?.[p.key]}
                      onChange={(v) =>
                        set({ headways: { ...s.headways, [l.code]: { ...(s.headways[l.code] ?? DEFAULT_SETTINGS.headways[l.code]), [p.key]: v ?? DEFAULT_SETTINGS.headways[l.code][p.key] } } })
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <button
        className="btn ghost danger"
        onClick={() => {
          if (confirm('Reset all settings (keys, walk times, headways) to defaults?')) settingsStore.set(DEFAULT_SETTINGS);
        }}
      >
        Reset all settings
      </button>
    </div>
  );
}

function WalkRow({ id, name, codes, value, placeholder }: { id: string; name: string; codes: string; value?: number; placeholder: string }) {
  return (
    <>
      <label>
        {name} <span className="muted tiny">{codes}</span>
      </label>
      <NumberField
        value={value}
        placeholder={placeholder}
        onChange={(v) => {
          const s = settingsStore.get();
          const next = { ...s.walkOverrides };
          if (v === undefined) delete next[id];
          else next[id] = v;
          settingsStore.patch({ walkOverrides: next });
        }}
        suffix="min"
      />
    </>
  );
}
