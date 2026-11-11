import { validAreas, type AreaIcon, type Pace } from './lifeVitals';
import { lifeVitalsStorageKey } from './lifeVitalsStorage';
import { simplePace, simpleVitalsKey, validSimpleVitals } from './simpleVitals';
import { statusVitalsExamples } from '../testing/statusVitalsExamples';
import { validPlans, type VitalPlans } from './vitalPlans';

export type VitalStatus = Exclude<Pace, 'unrated'>;
export type VitalEntry = {
  id: string; status: VitalStatus; reason: string; next: string;
  createdAt: string; updatedAt: string; onPace: string;
};
export type StatusVital = {
  id: string; name: string; icon: AreaIcon; onPace: string;
  entries: VitalEntry[]; archived?: boolean; plans?: VitalPlans;
};
export type CheckInDraft = Pick<VitalEntry, 'status' | 'reason' | 'next'>;
export const statusVitalsKey = (testing: boolean) => testing
  ? 'milestone-testing-status-vitals-v1' : 'milestone-status-vitals-v1';
export const newStatusVital = (): StatusVital => ({ id: crypto.randomUUID(), name: '', icon: 'projects', onPace: '', entries: [] });
export const historyEntries = (area: StatusVital) => [...area.entries].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
export const latestEntry = (area: StatusVital) => historyEntries(area)[0];
export const statusPace = (area: StatusVital): Pace => latestEntry(area)?.status ?? 'unrated';

export function saveCheckIn(area: StatusVital, draft: CheckInDraft, editId?: string, now = new Date().toISOString()): StatusVital {
  const old = editId ? area.entries.find(entry => entry.id === editId) : undefined;
  if (editId && !old) throw new Error('Check-in no longer exists');
  const entry: VitalEntry = {
    id: old?.id ?? crypto.randomUUID(), createdAt: old?.createdAt ?? now, updatedAt: now,
    status: draft.status, reason: draft.reason.trim(), next: draft.next.trim(), onPace: old?.onPace ?? area.onPace,
  };
  const next = { ...area, entries: old ? area.entries.map(e => e.id === old.id ? entry : e) : [entry, ...area.entries] };
  if (!validStatusVitals([next])) throw new Error('Invalid check-in');
  return next;
}

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const id = (v: unknown): v is string => typeof v === 'string' && !!v;
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
export function validStatusVitals(value: unknown): value is StatusVital[] {
  return Array.isArray(value) && value.length <= 100 && new Set(value.map(a => a?.id)).size === value.length && value.every(a =>
    object(a) && id(a.id) && text(a.name, 40) && !!a.name.trim() && text(a.onPace, 300) &&
    ['gym', 'school', 'work', 'projects', 'wellbeing', 'people'].includes(String(a.icon)) &&
    (a.archived === undefined || typeof a.archived === 'boolean') && (a.plans === undefined || validPlans(a.plans)) && Array.isArray(a.entries) &&
    new Set(a.entries.map(e => e?.id)).size === a.entries.length && a.entries.every(e => object(e) && id(e.id) &&
      ['behind', 'on-pace', 'ahead'].includes(String(e.status)) && text(e.reason, 600) && text(e.next, 200) &&
      text(e.onPace, 300) && date(e.createdAt) && date(e.updatedAt)));
}

export function loadStatusVitals(storage: Pick<Storage, 'getItem'>, testing: boolean): StatusVital[] {
  const saved = storage.getItem(statusVitalsKey(testing));
  if (saved !== null) {
    const parsed: unknown = JSON.parse(saved);
    if (!validStatusVitals(parsed)) throw new Error('Invalid saved Life Vitals');
    return parsed;
  }
  const simple = storage.getItem(simpleVitalsKey(testing));
  if (simple !== null) {
    const old: unknown = JSON.parse(simple);
    if (!validSimpleVitals(old)) throw new Error('Invalid previous Life Vitals');
    return old.map(area => {
      const status = simplePace(area);
      const onPace = area.checks.map(c => c.label).join('; ');
      return { id: area.id, name: area.name, icon: area.icon, archived: area.archived, onPace,
        entries: area.checkedAt && status !== 'unrated' ? [{ id: `${area.id}-previous`, status, reason: '', next: '',
          createdAt: area.checkedAt, updatedAt: area.checkedAt, onPace }] : [] };
    });
  }
  const detailed = storage.getItem(lifeVitalsStorageKey(testing));
  if (detailed !== null) {
    const old: unknown = JSON.parse(detailed);
    if (!validAreas(old)) throw new Error('Invalid previous Life Vitals');
    // Those records had no check-in timestamp. Do not invent historical entries.
    return old.map(a => ({ id: a.id, name: a.name, icon: a.icon, archived: a.archived, onPace: a.intention.slice(0, 300), entries: [] }));
  }
  return testing ? statusVitalsExamples() : [];
}
