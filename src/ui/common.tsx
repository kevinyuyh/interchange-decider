import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getApi } from '../lib/api';
import { lineMeta } from '../lib/network';
import { placesStore } from '../lib/store';
import type { Itinerary, Place } from '../lib/types';

/** "6:47" in Singapore time. */
export function fmtTime(t: number): string {
  const d = new Date(t + 8 * 3600_000);
  return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export function fmtMins(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m <= 0) return 'now';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function fmtDateTime(t: number): string {
  const d = new Date(t + 8 * 3600_000);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${fmtTime(t)}`;
}

export function useNow(intervalMs = 5000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    const onVis = () => document.visibilityState === 'visible' && setNow(Date.now());
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [intervalMs]);
  return now;
}

export function LinePill({ line }: { line?: string }) {
  const meta = lineMeta(line);
  return (
    <span className="pill" style={{ background: meta?.color ?? 'var(--muted-bg)' }}>
      {line ?? '?'}
    </span>
  );
}

export function BusPill({ svc }: { svc?: string }) {
  return <span className="pill bus">{svc ?? '?'}</span>;
}

export function LegChips({ it }: { it: Itinerary }) {
  const legs = it.legs.filter((l) => l.mode !== 'WALK');
  if (!legs.length) return <span className="muted">walk</span>;
  return (
    <span className="chips">
      {legs.map((l, i) => (
        <span key={i} className="chip-wrap">
          {i > 0 && <span className="arrow">›</span>}
          {l.mode === 'BUS' ? <BusPill svc={l.route} /> : <LinePill line={l.route} />}
        </span>
      ))}
    </span>
  );
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** OneMap address / postal search (or demo places), plus saved-place chips. */
export function PlacePicker({ value, onPick, placeholder, allowCurrent }: { value?: Place | null; onPick: (p: Place) => void; placeholder: string; allowCurrent?: boolean }) {
  const saved = placesStore.use();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    timer.current = window.setTimeout(async () => {
      setBusy(true);
      setErr('');
      try {
        setResults(await getApi().search(q.trim()));
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setBusy(false);
      }
    }, 300);
  }, [q]);

  const useCurrent = () => {
    setErr('');
    if (!navigator.geolocation) return setErr('Location not available');
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false);
        onPick({ id: 'here', name: 'Current location', lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      (e) => {
        setBusy(false);
        setErr(e.message || 'Could not get location');
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const pick = (p: Place) => {
    onPick(p);
    setQ('');
    setResults([]);
  };

  return (
    <div className="picker">
      {value && (
        <div className="picked">
          <strong>{value.name}</strong>
          {value.address && <span className="muted small">{value.address}</span>}
        </div>
      )}
      <div className="chip-row">
        {allowCurrent && (
          <button type="button" className="chip" onClick={useCurrent}>
            📍 Current location
          </button>
        )}
        {saved.map((p) => (
          <button type="button" key={p.id} className={`chip ${value?.id === p.id ? 'on' : ''}`} onClick={() => pick(p)}>
            {p.name}
          </button>
        ))}
      </div>
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} inputMode="search" autoComplete="off" />
      {busy && <div className="muted small pad">Searching…</div>}
      {err && <div className="error small pad">{err}</div>}
      {results.length > 0 && (
        <ul className="results">
          {results.map((r) => (
            <li key={r.id + r.lat}>
              <button type="button" onClick={() => pick({ ...r, id: `p${r.lat.toFixed(5)}${r.lng.toFixed(5)}` })}>
                <strong>{r.name}</strong>
                {r.address && <span className="muted small">{r.address}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function NumberField({ value, onChange, step = 0.5, min = 0, placeholder, suffix }: { value: number | undefined; onChange: (v: number | undefined) => void; step?: number; min?: number; placeholder?: string; suffix?: string }) {
  return (
    <span className="num">
      <input
        className="input"
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
      {suffix && <span className="muted small">{suffix}</span>}
    </span>
  );
}
