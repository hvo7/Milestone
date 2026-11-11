import type { StatusVital } from '../lib/statusVitals';

export function statusVitalsExamples(): StatusVital[] {
  const now = new Date();
  const stamp = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  return [
    { id: 'status-demo-school', name: 'School', icon: 'school', onPace: 'Review lectures within two days and submit assignments on time.', entries: [
      { id: 'school-now', status: 'behind', reason: 'Two lectures behind after focusing on another exam.', next: 'Review one lecture tonight.', createdAt: stamp(0), updatedAt: stamp(0), onPace: 'Review lectures within two days and submit assignments on time.' },
      { id: 'school-before', status: 'on-pace', reason: 'Caught up on this week’s material.', next: '', createdAt: stamp(3), updatedAt: stamp(3), onPace: 'Review lectures within two days and submit assignments on time.' },
    ] },
    { id: 'status-demo-gym', name: 'Gym', icon: 'gym', onPace: 'Keep my planned workout days.', entries: [
      { id: 'gym-now', status: 'on-pace', reason: 'Completed the workouts I planned.', next: '', createdAt: stamp(0), updatedAt: stamp(0), onPace: 'Keep my planned workout days.' },
    ] },
    { id: 'status-demo-work', name: 'Work', icon: 'work', onPace: 'Finish my main priorities by Friday.', entries: [
      { id: 'work-now', status: 'ahead', reason: 'Finished this week’s main task early.', next: 'Outline next week’s work.', createdAt: stamp(1), updatedAt: stamp(1), onPace: 'Finish my main priorities by Friday.' },
    ] },
  ];
}
