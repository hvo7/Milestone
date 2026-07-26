/** A questline's accent color — a hex string (from the color picker), or one of
 *  the legacy preset names ('crimson' etc.) saved by older versions of the app.
 *  Resolve display color through `categoryColor()` in lib/ui.ts, which understands
 *  both forms. */
export type GuildColor = string;
export type RecurringType = 'daily' | 'weekly' | 'monthly';

/** Custom repeat interval, in days, layered on top of `recurring`.
 *  When set it overrides the base cadence's timing — e.g. 21 = "every 3 weeks".
 *  The `recurring` field is still kept as the nearest bucket (day/week/month)
 *  so existing reset/streak code paths keep working. */
export type IntervalDays = number;

/** Which occurrence within the month: first…fourth, or -1 for last. */
export type NthPosition = 1 | 2 | 3 | 4 | -1;

/** What kind of day a monthly rule counts: any day, any weekday (Mon–Fri),
 *  any weekend day (Sat/Sun), or one specific weekday. */
export type DayKind =
  | 'day' | 'weekday' | 'weekend'
  | 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';

/** A calendar-style "nth weekday of the month" rule — "first Monday",
 *  "last weekday", "second weekend day of every 2 months".
 *
 *  It sits *alongside* `recurring`/`intervalDays` rather than replacing them:
 *  when set it wins, and `recurring` stays 'monthly' so anything that only
 *  understands the coarse bucket still behaves sensibly. Resolves to exactly
 *  one date per active month (see lib/monthlyRule.ts). */
export interface MonthlyRule {
  nth: NthPosition;
  kind: DayKind;
  /** Fire every N months (default/absent = every month). */
  months?: number;
  /** Absolute month index (year*12+month) the rule was set in — the origin
   *  "every N months" counts from. Only meaningful when `months` > 1. */
  anchorMonth?: number;
}

/** The scheduling fields shared by every repeatable thing in the app (routines,
 *  quests, quest actions, Vynues tasks). The recurrence engine in store.ts takes
 *  this shape, so those entities can be passed to it directly. */
export interface Schedule {
  recurring?: RecurringType | null;
  intervalDays?: number;
  monthlyRule?: MonthlyRule | null;
  lastResetAt?: string;
}

export interface Action {
  id: string;
  title: string;
  completed: boolean;
  trackedToday?: boolean;
  hidden?: boolean;
  recurring?: RecurringType | null;
  intervalDays?: IntervalDays;
  /** Calendar rule ("first Monday of the month"); overrides the cadence above. */
  monthlyRule?: MonthlyRule | null;
  lastResetAt?: string;
}

export interface Quest {
  id: string;
  title: string;
  description: string;
  order: number;
  actions: Action[];
  hidden?: boolean;
  recurring?: RecurringType | null;
  intervalDays?: IntervalDays;
  /** Calendar rule ("first Monday of the month"); overrides the cadence above. */
  monthlyRule?: MonthlyRule | null;
  lastResetAt?: string;
  streak?: number;
  dueDate?: string | null;
  /** Pinned to the Today list as its own item. A quest is a trackable thing in
   *  its own right — you can pin it whether or not it has sub-tasks, and it shows
   *  on Today with its actions as check-off steps beneath it. */
  trackedToday?: boolean;
  /** Completion for a quest that has no sub-tasks. When a quest has actions its
   *  completion is derived from them (all done = quest done); this field is the
   *  fallback for the action-less case, so such a quest can still be checked off
   *  on Today. Ignored while the quest has visible actions. */
  completed?: boolean;
}

export interface Questline {
  id: string;
  title: string;
  description: string;
  icon: string;
  color: GuildColor;
  quests: Quest[];
  hidden?: boolean;
  sequential?: boolean;
  recurring?: RecurringType | null;
  lastResetAt?: string;
  streak?: number;
}

/** A checklist item under a routine. Subtasks nest without limit — any step can
 *  be broken into smaller steps via `children`, since the "simplest" version of a
 *  step often only becomes clear later. Old saves (flat arrays, no timestamps)
 *  load as-is: both new fields are optional. */
export interface Subtask {
  id: string;
  title: string;
  completed: boolean;
  /** ISO instant this step was checked — lets a weekly goal ("gym 3×") credit the
   *  day a session actually happened, so Today can count it as done-for-today. */
  completedAt?: string;
  /** Nested breakdown of this step (infinite depth). */
  children?: Subtask[];
}

/** Recurring task — can be standalone or linked to a questline */
export interface Routine {
  id: string;
  title: string;
  description?: string;
  /** Cadence bucket, or null for a one-time task (no reset; persists until deleted). */
  recurring: RecurringType | null;
  /** Custom repeat interval in days (overrides cadence; e.g. 21 = every 3 weeks). */
  intervalDays?: IntervalDays;
  /** Calendar rule ("first Monday of the month", "last weekday"). Takes precedence
   *  over both fields above — see lib/monthlyRule.ts. */
  monthlyRule?: MonthlyRule | null;
  /** One-off due date ('YYYY-MM-DD') for non-recurring tasks. Drives Today visibility:
   *  a one-time task surfaces on Today from its due date onward (today or overdue). */
  dueDate?: string | null;
  completed: boolean;
  /** ISO instant the task was last marked complete. Drives Today visibility for
   *  one-time tasks: a completed one-off shows only on its completion day, then
   *  drops off Today once the logical day rolls over (it's done — no need to keep
   *  showing it). Cleared when unchecked or when a recurring task resets. */
  completedAt?: string;
  /** Counter mode. When set, the task completes only once `progress` reaches
   *  `target` — e.g. target 3 = "go to the gym 3×"; target 64, unit "oz" =
   *  "drink 64oz water". It still counts as a single task in Today's totals. */
  target?: number;
  /** Current counter value (0…target). Undefined for plain checkbox tasks. */
  progress?: number;
  /** How much each +/- tap changes `progress` (default 1; e.g. 8 for oz of water). */
  step?: number;
  /** Optional unit shown beside the counter, e.g. "oz", "pages". */
  unit?: string;
  /** Logical-day key ('YYYY-MM-DD') this task was skipped on, if any.
   *  A skip is a *neutral* day, for when the task is genuinely impossible rather
   *  than merely undone — e.g. a walk on a rainy day. It earns no heatmap credit,
   *  and at rollover the streak is preserved (neither extended nor broken), unlike
   *  an ordinary miss which resets it to 0.
   *  A skip excuses only the day it was made: it lapses at the next 5am and the task
   *  simply comes back. Skipping Monday's gym session no longer writes off the whole
   *  week — Tuesday the goal is right back on Today. */
  skippedOn?: string;
  /** True if any day of the current cycle was skipped. Read at rollover so a
   *  weekly goal that lost a day to a skip keeps its streak instead of breaking it.
   *  Cleared when the period resets. */
  skippedInCycle?: boolean;
  /** ISO instant of the last counter progress (+ tap). For multi-day goals
   *  ("gym 3× a week") this is what marks *today's session* done on Today. */
  lastProgressAt?: string;
  trackedToday: boolean;
  lastResetAt?: string;
  streak?: number;
  hidden?: boolean;
  questlineId?: string;
  /** Optional specific quest (within questlineId) this task is connected to. */
  questId?: string;
  /** Belongs to the highlighted "Fixing my Chud life" comeback category on Today.
   *  Anchor habits are standalone (no questline) but still reset + build a streak
   *  each period, unlike ordinary standalone todos. */
  anchor?: boolean;
  /** Manual sort position within its Today group (lower = higher up). */
  order?: number;
  /** Optional checklist breakdown of this task. */
  subtasks?: Subtask[];
}
