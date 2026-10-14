// Pure scheduling configuration: persistence is owned by uiStore, not the domain.
let minutes = 120;
export function configureResetTime(value: string | undefined): void {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value ?? '')) { minutes = 120; return; }
  const [hour, minute] = value!.split(':').map(Number);
  minutes = hour * 60 + minute;
}
export function resetMinutes(): number { return minutes; }
export function atResetTime(date: Date): Date {
  const result = new Date(date);
  result.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return result;
}
