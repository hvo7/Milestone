import type { Factor, LifeArea } from '../lib/lifeVitals';

/** Fictional examples only. Never seed these into a production profile. */
export function lifeVitalsExamples(): LifeArea[] {
  const metric = (id: string, name: string, unit: string, actual: number, expected: number, target: number, kind: Factor['kind'] = 'progress'): Factor => ({
    id, name, unit, actual, expected, target, kind, tolerance: 0, assessment: 'unrated', criteria: '', included: true,
  });
  return [
    { id: 'demo-gym', name: 'Gym', icon: 'gym', intention: 'Build strength and stay consistent.', period: 'Example week',
      factors: [metric('workouts', 'Workouts', 'sessions', 1, 2, 4), metric('walks', 'Walks', 'walks', 4, 4, 7)],
      next: 'Make time for a 45-minute lift.', note: 'One workout gets me back on pace.' },
    { id: 'demo-school', name: 'School', icon: 'school', intention: 'Keep up with class without cramming.', period: 'Example week',
      factors: [metric('reviews', 'Lectures reviewed', 'lectures', 6, 6, 10), metric('assignments', 'Assignments', 'assignments', 2, 2, 3)],
      next: 'Review the next lecture.', note: 'Short daily review sessions are helping.' },
    { id: 'demo-work', name: 'Work', icon: 'work', intention: 'Move the important work forward.', period: 'Example week',
      factors: [metric('priorities', 'Priorities completed', 'priorities', 4, 3, 5)],
      next: 'Outline next week\'s priorities.', note: 'Finished the main deliverable early.' },
    { id: 'demo-finances', name: 'Finances', icon: 'work', intention: 'Keep spending intentional.', period: 'Example month',
      factors: [metric('spending', 'Optional spending', 'dollars', 120, 150, 300, 'limit'), metric('saving', 'Savings added', 'dollars', 250, 200, 400)],
      next: 'Review upcoming bills.', note: 'An example of a limit alongside a savings goal.' },
    { id: 'demo-wellbeing', name: 'Wellbeing', icon: 'wellbeing', intention: 'Leave energy for myself.', period: 'Example week',
      factors: [{ ...metric('energy', 'Energy', '', 0, 0, 0, 'manual'), assessment: 'behind', criteria: 'Behind: drained. On pace: manageable. Ahead: rested with energy to spare.' }],
      next: 'Take a quiet evening off.', note: 'This area uses a personal assessment instead of a number.' },
    { id: 'demo-relationships', name: 'Relationships', icon: 'people', intention: 'Make time for people who matter.', period: 'Example week',
      factors: [metric('catchups', 'Quality catch-ups', 'catch-ups', 1, 1, 2)],
      next: 'Arrange a weekend catch-up.', note: 'All these areas, factors and targets can be changed.' },
  ];
}
