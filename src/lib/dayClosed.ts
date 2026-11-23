/**
 * "Day closed": the moment the day's progress reaches 100%.
 *
 * The closed state itself is just progress and is shown for as long as it holds.
 * The moment — the ring closing — plays once per logical day, so reopening a
 * task and finishing it again doesn't replay it. The day it last played is an
 * optional UI preference; builds that predate it ignore the key.
 */
import { useUIStore } from '../uiStore';

/** Progress has reached 100% on a real day with something on it. */
export const isDayClosed = (done: number, total: number, preview = false): boolean =>
  !preview && total > 0 && done >= total;

/** True the first time it is asked on `dayKey`, and records that it was. */
export function claimDayClosed(dayKey: string): boolean {
  if (useUIStore.getState().dayClosedOn === dayKey) return false;
  useUIStore.setState({ dayClosedOn: dayKey });
  return true;
}
