import { nextDailyReset } from '../domain/schedule';

export const REFRESH_DAY_EVENT = 'milestone:refresh-day';

/** Use the device's local clock; catch up after sleep or a clock/time-zone change. */
export function startDayClock(refresh: () => void): () => void {
  let boundary: ReturnType<typeof setTimeout>;
  const run = () => {
    clearTimeout(boundary);
    refresh();
    boundary = setTimeout(run, Math.max(1, nextDailyReset().getTime() - Date.now()));
  };
  const onVisible = () => { if (document.visibilityState === 'visible') run(); };
  run();
  const poll = setInterval(run, 60_000);
  window.addEventListener('focus', run);
  window.addEventListener(REFRESH_DAY_EVENT, run);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    clearTimeout(boundary);
    clearInterval(poll);
    window.removeEventListener('focus', run);
    window.removeEventListener(REFRESH_DAY_EVENT, run);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
