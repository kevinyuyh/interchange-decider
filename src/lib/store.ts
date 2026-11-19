// Tiny localStorage-backed store with React subscription. Everything is per
// device; the single userId is kept so data can later move to a shared backend.
import { useSyncExternalStore } from 'react';
import { DEFAULT_HEADWAYS } from './network';
import { USER_ID, type Place, type Settings, type Trip, type VerdictLogEntry } from './types';

const PREFIX = `interchange:${USER_ID}:`;
const listeners = new Map<string, Set<() => void>>();
const memory = new Map<string, unknown>(); // fallback when storage is blocked + parse cache

function read<T>(key: string, fallback: T): T {
  if (memory.has(key)) return memory.get(key) as T;
  let value = fallback;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw) value = JSON.parse(raw) as T;
  } catch {
    /* private mode / blocked storage: keep in memory only */
  }
  memory.set(key, value);
  return value;
}

function write<T>(key: string, value: T) {
  memory.set(key, value);
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* quota or blocked */
  }
  listeners.get(key)?.forEach((fn) => fn());
}

function subscribe(key: string, fn: () => void) {
  let set = listeners.get(key);
  if (!set) listeners.set(key, (set = new Set()));
  set.add(fn);
  return () => set!.delete(fn);
}

export const DEFAULT_SETTINGS: Settings = {
  demo: true,
  routing: 'builtin',
  demoDisruption: false,
  datamallKey: '',
  onemapEmail: '',
  onemapPassword: '',
  onemapToken: '',
  onemapTokenExpiry: 0,
  busSource: 'arrivelah',
  datamallBase: '/datamall',
  samples: 1000,
  sigmaMonitoredMin: 1,
  sigmaUnmonitoredMin: 3,
  defaultBusHeadwayMin: 10,
  defaultWalkMin: 3,
  walkOverrides: {},
  headways: DEFAULT_HEADWAYS,
  notifyLeadMin: 2,
};

function makeBinding<T>(key: string, fallback: T) {
  return {
    get: () => read<T>(key, fallback),
    set: (v: T | ((prev: T) => T)) => write(key, typeof v === 'function' ? (v as (p: T) => T)(read(key, fallback)) : v),
    use: () => useSyncExternalStore((fn) => subscribe(key, fn), () => read<T>(key, fallback)),
  };
}

const settingsBinding = makeBinding<Settings>('settings', DEFAULT_SETTINGS);
export const settingsStore = {
  ...settingsBinding,
  // Merge so new settings fields get defaults after an upgrade.
  get: (): Settings => ({ ...DEFAULT_SETTINGS, ...settingsBinding.get() }),
  use: (): Settings => {
    const s = settingsBinding.use();
    return s === DEFAULT_SETTINGS ? s : { ...DEFAULT_SETTINGS, ...s };
  },
  patch: (p: Partial<Settings>) => settingsBinding.set((prev) => ({ ...DEFAULT_SETTINGS, ...prev, ...p })),
};

export const placesStore = makeBinding<Place[]>('places', []);
export const tripStore = makeBinding<Trip | null>('trip', null);
export const logStore = makeBinding<VerdictLogEntry[]>('log', []);
export const tripHistoryStore = makeBinding<Trip[]>('trips', []);

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
