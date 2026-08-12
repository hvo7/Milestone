/**
 * Search across everything, as a pure function.
 *
 * The app had no text search at all: four questlines' worth of quests, actions
 * and nestable steps, plus Vynues, and the only way to find something was to
 * remember where you filed it. That gets worse every week you use it.
 *
 * Kept free of React so it can be tested directly — ranking is the part that
 * decides whether search feels useful or useless, and it's not something you want
 * to verify by squinting at a dropdown.
 */
import type { Questline, Routine } from '../types';
import type { VynuesProject } from '../vynuesStore';
import { flattenSubtasks, repeats, recurrenceLabel } from '../store';
import { flattenVynuesSubtasks } from '../vynuesStore';
import { cleanQuest, ANCHOR_LABEL } from './ui';

export type ResultKind = 'questline' | 'quest' | 'action' | 'routine' | 'project' | 'vynues-task' | 'step';

export interface SearchResult {
  id: string;
  kind: ResultKind;
  title: string;
  /** Where it lives — "Health & Fitness · Week 3", "Vynues · Website". */
  context?: string;
  /** Short right-hand hint: a cadence, a due date, "done". */
  hint?: string;
  /** Route to send the user to. Quests and actions have no route of their own, so
   *  they resolve to the questline that holds them. */
  path: string;
  /** Lower sorts first. */
  score: number;
}

/** How the query matched, best first. A title that *starts* with what you typed
 *  is almost always what you meant; a hit buried in the parent's name almost
 *  never is. */
const MATCH_EXACT = 0, MATCH_PREFIX = 1, MATCH_WORD = 2, MATCH_SUB = 3, MATCH_CONTEXT = 6;

/** Ordering between kinds at equal match quality: the things you act on daily
 *  come before the containers they live in. */
const KIND_RANK: Record<ResultKind, number> = {
  routine: 0, action: 1, 'vynues-task': 1, quest: 2, step: 3, questline: 4, project: 4,
};

const norm = (s: string) => s.toLowerCase().trim();

/** Match quality of one term against one title, or null when it doesn't match. */
function scoreTitle(title: string, term: string): number | null {
  const t = norm(title);
  if (t === term) return MATCH_EXACT;
  if (t.startsWith(term)) return MATCH_PREFIX;
  // Word boundary: "gym" should find "Go to the gym", ahead of "Algymnastics".
  if (new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(t)) return MATCH_WORD;
  return t.includes(term) ? MATCH_SUB : null;
}

/**
 * Score one candidate against every term. All terms must match *something* —
 * typing two words should narrow, not widen — and the result takes the worst
 * (highest) per-term match, so "gym week" ranks behind an item where both words
 * are in the title itself.
 */
function scoreItem(title: string, context: string | undefined, terms: string[]): number | null {
  let worst = 0;
  for (const term of terms) {
    const inTitle = scoreTitle(title, term);
    const inContext = inTitle === null && context ? scoreTitle(context, term) : null;
    if (inTitle === null && inContext === null) return null;
    worst = Math.max(worst, inTitle ?? MATCH_CONTEXT + (inContext ?? 0));
  }
  return worst;
}

export interface SearchSources {
  questlines: Questline[];
  routines: Routine[];
  projects: VynuesProject[];
}

/** Every searchable thing in the app, flattened into one candidate list. */
function candidates({ questlines, routines, projects }: SearchSources): Omit<SearchResult, 'score'>[] {
  const out: Omit<SearchResult, 'score'>[] = [];

  for (const ql of questlines) {
    const path = `/questline/${ql.id}`;
    out.push({ id: ql.id, kind: 'questline', title: ql.title, path, hint: `${ql.quests.length} quests` });
    for (const q of ql.quests) {
      const questTitle = cleanQuest(q.title);
      out.push({ id: q.id, kind: 'quest', title: questTitle, context: ql.title, path, hint: `${q.actions.length} tasks` });
      for (const a of q.actions) {
        out.push({
          id: a.id, kind: 'action', title: a.title,
          context: `${ql.title} · ${questTitle}`, path,
          hint: a.completed ? 'done' : repeats(a) ? recurrenceLabel(a) : undefined,
        });
      }
    }
  }

  for (const r of routines) {
    const ql = r.questlineId ? questlines.find(x => x.id === r.questlineId) : undefined;
    // Routines live on Today when due and in All otherwise; All lists every one of
    // them, so it's the destination that always contains what was clicked.
    out.push({
      id: r.id, kind: 'routine', title: r.title,
      // Via the constant, never a copy of the string: a search result that names
      // the group differently from the tab it lives on reads as two things.
      context: ql?.title ?? (r.anchor ? ANCHOR_LABEL : 'General'),
      path: '/all',
      hint: r.completed ? 'done' : repeats(r) ? recurrenceLabel(r) : r.dueDate ? `due ${r.dueDate}` : undefined,
    });
    for (const st of flattenSubtasks(r.subtasks)) {
      out.push({ id: st.id, kind: 'step', title: st.title, context: r.title, path: '/all', hint: st.completed ? 'done' : undefined });
    }
  }

  for (const p of projects) {
    out.push({ id: p.id, kind: 'project', title: p.name, context: 'Vynues', path: '/vynues', hint: `${p.tasks.length} tasks` });
    for (const t of p.tasks) {
      out.push({
        id: t.id, kind: 'vynues-task', title: t.title, context: `Vynues · ${p.name}`, path: '/vynues',
        hint: t.done ? 'done' : repeats(t) ? recurrenceLabel(t) : undefined,
      });
      for (const st of flattenVynuesSubtasks(t.subtasks)) {
        out.push({ id: st.id, kind: 'step', title: st.title, context: `${p.name} · ${t.title}`, path: '/vynues', hint: st.done ? 'done' : undefined });
      }
    }
  }

  return out;
}

/** Ranked matches for `query`, best first. An empty query matches nothing —
 *  a palette that lists your entire app before you type is noise. */
export function search(sources: SearchSources, query: string, limit = 24): SearchResult[] {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];

  const hits: SearchResult[] = [];
  for (const c of candidates(sources)) {
    const score = scoreItem(c.title, c.context, terms);
    if (score === null) continue;
    hits.push({ ...c, score });
  }

  return hits
    .sort((a, b) =>
      a.score - b.score
      || KIND_RANK[a.kind] - KIND_RANK[b.kind]
      // Shorter titles first at equal quality: "Gym" beats "Gym bag shopping list"
      // when you typed "gym".
      || a.title.length - b.title.length
      || a.title.localeCompare(b.title))
    .slice(0, limit);
}

/** Glyph shown beside a result, so the kind reads without a text label. */
export const KIND_ICON: Record<ResultKind, string> = {
  questline: '📜', quest: '⚔', action: '•', routine: '◇', project: '🚩', 'vynues-task': '•', step: '↳',
};

/** Human name for a kind, for the result's right-hand caption. */
export const KIND_LABEL: Record<ResultKind, string> = {
  questline: 'Questline', quest: 'Quest', action: 'Task', routine: 'Task',
  project: 'Project', 'vynues-task': 'Task', step: 'Step',
};
