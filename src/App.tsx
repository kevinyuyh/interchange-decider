import { useState } from 'react';
import { settingsStore, tripStore } from './lib/store';
import { LogTab, PlacesTab, SettingsTab } from './ui/OtherTabs';
import { TripTab } from './ui/TripTab';

type Tab = 'trip' | 'places' | 'log' | 'settings';
const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'trip', label: 'Trip', icon: '🚉' },
  { key: 'places', label: 'Places', icon: '📍' },
  { key: 'log', label: 'Log', icon: '📒' },
  { key: 'settings', label: 'Settings', icon: '⚙️' },
];

export function App() {
  const [tab, setTab] = useState<Tab>('trip');
  const trip = tripStore.use();
  const settings = settingsStore.use();

  return (
    <div className="app">
      <header className="top">
        <h1>Interchange</h1>
        <span className="muted small">{settings.demo ? 'Demo data' : settings.routing === 'builtin' ? 'Live · built-in routing' : 'Live · OneMap'}</span>
      </header>
      <main className="main">
        {/* Trip stays mounted so verdict refresh and alerts keep running on other tabs. */}
        <div hidden={tab !== 'trip'}>
          <TripTab />
        </div>
        {tab === 'places' && <PlacesTab />}
        {tab === 'log' && <LogTab />}
        {tab === 'settings' && <SettingsTab />}
      </main>
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
            <span className="ti">{t.icon}</span>
            <span>{t.label}</span>
            {t.key === 'trip' && trip && <span className="dot" />}
          </button>
        ))}
      </nav>
    </div>
  );
}
