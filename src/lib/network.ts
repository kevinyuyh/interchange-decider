import type { Period } from './types';

export interface LineMeta {
  code: string;
  name: string;
  color: string;
  /** Line code used by DataMall TrainServiceAlerts. */
  alertCode: string;
}

export const LINES: LineMeta[] = [
  { code: 'NS', name: 'North South', color: '#d42e12', alertCode: 'NSL' },
  { code: 'EW', name: 'East West', color: '#009645', alertCode: 'EWL' },
  { code: 'CG', name: 'Changi Airport branch', color: '#009645', alertCode: 'CGL' },
  { code: 'NE', name: 'North East', color: '#9900aa', alertCode: 'NEL' },
  { code: 'CC', name: 'Circle', color: '#fa9e0d', alertCode: 'CCL' },
  { code: 'CE', name: 'Circle (Bayfront ext.)', color: '#fa9e0d', alertCode: 'CEL' },
  { code: 'DT', name: 'Downtown', color: '#005ec4', alertCode: 'DTL' },
  { code: 'TE', name: 'Thomson-East Coast', color: '#9d5b25', alertCode: 'TEL' },
  { code: 'BP', name: 'Bukit Panjang LRT', color: '#748477', alertCode: 'BPL' },
  { code: 'SK', name: 'Sengkang LRT', color: '#748477', alertCode: 'SLRT' },
  { code: 'PG', name: 'Punggol LRT', color: '#748477', alertCode: 'PLRT' },
];

export const lineMeta = (code?: string) => LINES.find((l) => l.code === code);

export const lineFromAlertCode = (alert: string) =>
  LINES.find((l) => l.alertCode === alert.trim().toUpperCase())?.code;

/** "NS17" -> "NS", "STC"/"SE1" -> "SK", "PTC"/"PW3" -> "PG". */
export function lineFromStationCode(code?: string): string | undefined {
  if (!code) return undefined;
  const c = code.trim().toUpperCase();
  if (c === 'STC' || /^S[EW]\d/.test(c)) return 'SK';
  if (c === 'PTC' || /^P[EW]\d/.test(c)) return 'PG';
  const m = c.match(/^([A-Z]{2})\d/);
  return m && lineMeta(m[1]) ? m[1] : undefined;
}

export interface Interchange {
  id: string;
  name: string;
  codes: string[];
  lat: number;
  lng: number;
}

// Rail interchanges (stations served by 2+ lines). Coordinates are approximate
// station centres; they are only used as the start point for OneMap X→B queries.
export const INTERCHANGES: Interchange[] = [
  { id: 'jurong-east', name: 'Jurong East', codes: ['NS1', 'EW24'], lat: 1.3332, lng: 103.7422 },
  { id: 'choa-chu-kang', name: 'Choa Chu Kang', codes: ['NS4', 'BP1'], lat: 1.3854, lng: 103.7444 },
  { id: 'bukit-panjang', name: 'Bukit Panjang', codes: ['DT1', 'BP6'], lat: 1.3784, lng: 103.7622 },
  { id: 'woodlands', name: 'Woodlands', codes: ['NS9', 'TE2'], lat: 1.437, lng: 103.7865 },
  { id: 'bishan', name: 'Bishan', codes: ['NS17', 'CC15'], lat: 1.351, lng: 103.8485 },
  { id: 'newton', name: 'Newton', codes: ['NS21', 'DT11'], lat: 1.3138, lng: 103.838 },
  { id: 'orchard', name: 'Orchard', codes: ['NS22', 'TE14'], lat: 1.3043, lng: 103.8322 },
  { id: 'dhoby-ghaut', name: 'Dhoby Ghaut', codes: ['NS24', 'NE6', 'CC1'], lat: 1.299, lng: 103.8456 },
  { id: 'city-hall', name: 'City Hall', codes: ['NS25', 'EW13'], lat: 1.2931, lng: 103.852 },
  { id: 'raffles-place', name: 'Raffles Place', codes: ['NS26', 'EW14'], lat: 1.284, lng: 103.8515 },
  { id: 'marina-bay', name: 'Marina Bay', codes: ['NS27', 'CC33', 'CE2', 'TE20'], lat: 1.2764, lng: 103.8546 },
  { id: 'bugis', name: 'Bugis', codes: ['EW12', 'DT14'], lat: 1.3009, lng: 103.8559 },
  { id: 'outram-park', name: 'Outram Park', codes: ['EW16', 'NE3', 'TE17'], lat: 1.2803, lng: 103.8395 },
  { id: 'buona-vista', name: 'Buona Vista', codes: ['EW21', 'CC22'], lat: 1.3073, lng: 103.7901 },
  { id: 'paya-lebar', name: 'Paya Lebar', codes: ['EW8', 'CC9'], lat: 1.3176, lng: 103.8926 },
  { id: 'tanah-merah', name: 'Tanah Merah', codes: ['EW4', 'CG'], lat: 1.3272, lng: 103.9465 },
  { id: 'tampines', name: 'Tampines', codes: ['EW2', 'DT32'], lat: 1.3533, lng: 103.9452 },
  { id: 'expo', name: 'Expo', codes: ['CG1', 'DT35'], lat: 1.335, lng: 103.9615 },
  { id: 'harbourfront', name: 'HarbourFront', codes: ['NE1', 'CC29'], lat: 1.2653, lng: 103.822 },
  { id: 'chinatown', name: 'Chinatown', codes: ['NE4', 'DT19'], lat: 1.2844, lng: 103.8439 },
  { id: 'little-india', name: 'Little India', codes: ['NE7', 'DT12'], lat: 1.3066, lng: 103.8494 },
  { id: 'serangoon', name: 'Serangoon', codes: ['NE12', 'CC13'], lat: 1.3498, lng: 103.8737 },
  { id: 'sengkang', name: 'Sengkang', codes: ['NE16', 'STC'], lat: 1.3917, lng: 103.8954 },
  { id: 'punggol', name: 'Punggol', codes: ['NE17', 'PTC'], lat: 1.4051, lng: 103.9023 },
  { id: 'promenade', name: 'Promenade', codes: ['CC4', 'DT15'], lat: 1.2934, lng: 103.861 },
  { id: 'bayfront', name: 'Bayfront', codes: ['CC34', 'CE1', 'DT16'], lat: 1.2819, lng: 103.859 },
  { id: 'macpherson', name: 'MacPherson', codes: ['CC10', 'DT26'], lat: 1.3266, lng: 103.8899 },
  { id: 'botanic-gardens', name: 'Botanic Gardens', codes: ['CC19', 'DT9'], lat: 1.3224, lng: 103.8152 },
  { id: 'caldecott', name: 'Caldecott', codes: ['CC17', 'TE9'], lat: 1.3375, lng: 103.8395 },
  { id: 'stevens', name: 'Stevens', codes: ['DT10', 'TE11'], lat: 1.32, lng: 103.8259 },
  { id: 'sungei-bedok', name: 'Sungei Bedok', codes: ['DT37', 'TE31'], lat: 1.3213, lng: 103.959 },
];

/** "BISHAN MRT STATION (NS17 / CC15)" -> "bishan" */
export function normaliseStationName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(mrt|lrt)\b/g, ' ')
    .replace(/\b(station|interchange|stn)\b/g, ' ')
    .replace(/[^a-z]/g, '');
}

const byName = new Map(INTERCHANGES.map((i) => [normaliseStationName(i.name), i]));
const byCode = new Map(INTERCHANGES.flatMap((i) => i.codes.map((c) => [c, i] as const)));

export function findInterchange(name?: string, code?: string): Interchange | undefined {
  if (code) {
    for (const part of code.toUpperCase().split(/[\s/,]+/)) {
      const hit = byCode.get(part);
      if (hit) return hit;
    }
  }
  return name ? byName.get(normaliseStationName(name)) : undefined;
}

/**
 * Fallback headways (minutes) by line and period, from LTA's published train
 * frequency ranges. Editable in Settings; replace with GTFSScheduleTrain values
 * once the feed has been inspected.
 */
export const DEFAULT_HEADWAYS: Record<string, Record<Period, number>> = {
  NS: { peak: 2.5, offpeak: 5, night: 7 },
  EW: { peak: 2.5, offpeak: 5, night: 7 },
  CG: { peak: 5, offpeak: 8, night: 10 },
  NE: { peak: 2.5, offpeak: 5, night: 7 },
  CC: { peak: 3.5, offpeak: 6, night: 8 },
  CE: { peak: 5, offpeak: 8, night: 10 },
  DT: { peak: 2.5, offpeak: 5, night: 7 },
  TE: { peak: 3, offpeak: 5, night: 7 },
  BP: { peak: 3.5, offpeak: 5, night: 7 },
  SK: { peak: 3.5, offpeak: 5, night: 7 },
  PG: { peak: 3.5, offpeak: 5, night: 7 },
};

/** Weekday 07:00–09:30 and 17:00–20:00 are peak; 22:30–06:30 is night. Singapore time. */
export function periodAt(t: number): Period {
  const sg = new Date(t + 8 * 3600_000); // read UTC fields as SGT
  const day = sg.getUTCDay();
  const h = sg.getUTCHours() + sg.getUTCMinutes() / 60;
  if (h >= 22.5 || h < 6.5) return 'night';
  const weekday = day >= 1 && day <= 5;
  if (weekday && ((h >= 7 && h < 9.5) || (h >= 17 && h < 20))) return 'peak';
  return 'offpeak';
}
