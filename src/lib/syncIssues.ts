/**
 * The sync issue list: what a merge set aside, kept until you restore or dismiss it.
 *
 * Merging item by item means almost nothing needs you — but when the same item
 * was edited on two devices before either saw the other, one edit has to give
 * way, and when one device deleted what another was editing, the item is kept.
 * Those are written here with the version that gave way, so it can be put back.
 *
 * The list syncs like everything else (it is a store with items), so an issue
 * found by the laptop shows on the phone, and dismissing it anywhere dismisses it
 * everywhere. An issue's id is derived from what it describes, so two devices
 * that notice the same conflict produce one entry, not two.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const SYNC_ISSUES_KEY = 'milestone-sync-issues';

export type IssueKind = 'edit' | 'delete';
export type IssueStatus = 'open' | 'restored' | 'dismissed';

export interface SyncIssue {
  id: string;
  kind: IssueKind;
  /** The synced store it belongs to, and the item's path inside it. */
  slot: string;
  path: string;
  /** The item's name when the issue was found. */
  label: string;
  keptFrom: string;
  lostFrom: string;
  /** The version that gave way, exactly as stored, for Restore. Null when what
   *  gave way was a deletion. */
  lost: string | null;
  /** Where the item sits, so a removed one can be put back. */
  parent: string | null;
  field: string | null;
  at: string;
  status: IssueStatus;
  closedAt?: string;
}

interface IssuesState { issues: SyncIssue[] }

export const useSyncIssues = create<IssuesState>()(persist(() => ({ issues: [] as SyncIssue[] }), { name: SYNC_ISSUES_KEY }));

/** Closed issues are kept this long, then dropped. Open ones stay until closed. */
const CLOSED_DAYS = 30;
const MAX_ISSUES = 100;

function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

export type NewIssue = Omit<SyncIssue, 'id' | 'status' | 'at'>;

export const issueId = (issue: Pick<SyncIssue, 'kind' | 'slot' | 'path' | 'lost'>) =>
  `si-${hash(`${issue.kind}|${issue.slot}|${issue.path}|${issue.lost ?? ''}`)}`;

export function prune(issues: SyncIssue[], now = Date.now()): SyncIssue[] {
  const cutoff = now - CLOSED_DAYS * 86_400_000;
  const kept = issues.filter(issue => issue.status === 'open' || Date.parse(issue.closedAt ?? issue.at) >= cutoff);
  return kept.length > MAX_ISSUES ? [...kept].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, MAX_ISSUES) : kept;
}

/** Adds what is new; returns how many were. */
export function recordIssues(found: NewIssue[]): number {
  if (!found.length) return 0;
  const { issues } = useSyncIssues.getState();
  const known = new Set(issues.map(issue => issue.id));
  const at = new Date().toISOString();
  const added = found.map(issue => ({ ...issue, id: issueId(issue), status: 'open' as const, at })).filter(issue => {
    if (known.has(issue.id)) return false;
    known.add(issue.id);
    return true;
  });
  if (added.length) useSyncIssues.setState({ issues: prune([...added, ...issues]) });
  return added.length;
}

export function closeIssue(id: string, status: Exclude<IssueStatus, 'open'>): void {
  useSyncIssues.setState(state => ({
    issues: prune(state.issues.map(issue => issue.id === id ? { ...issue, status, closedAt: new Date().toISOString() } : issue)),
  }));
}

export const openIssues = (issues: SyncIssue[]) => issues.filter(issue => issue.status === 'open');
