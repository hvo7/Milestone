/**
 * Reminder scheduling.
 *
 * Every interesting case here is a clock case — the hour rolling past, a device
 * asleep at the appointed minute, the 5am logical-day boundary that sits four
 * hours after the calendar one. None are worth testing by waiting for them, and
 * the failure mode of getting them wrong (a notification twice a night, or never)
 * is the kind that gets the feature switched off permanently.
 */
import { describe, it, expect } from 'vitest';
import { parseTime, shouldFire, reminderBody } from './reminders';

const on = { enabled: true, time: '19:00' };
const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m, d, h, min);
const AUG = 7;

describe('parseTime', () => {
  it('reads a time of day into minutes', () => {
    expect(parseTime('19:00')).toBe(19 * 60);
    expect(parseTime('00:00')).toBe(0);
    expect(parseTime('9:05')).toBe(9 * 60 + 5);
  });

  it('rejects anything that is not one', () => {
    // An unparseable time must disable the reminder rather than default to
    // midnight — firing at an hour nobody chose is worse than not firing.
    for (const bad of ['', '25:00', '12:60', 'noon', '1900', '12:5']) {
      expect(parseTime(bad)).toBeNull();
    }
  });
});

describe('shouldFire', () => {
  it('waits until the chosen time', () => {
    expect(shouldFire(on, 3, '', at(2026, AUG, 10, 18, 59))).toBe(false);
    expect(shouldFire(on, 3, '', at(2026, AUG, 10, 19, 0))).toBe(true);
  });

  it('stays quiet when the setting is off', () => {
    expect(shouldFire({ enabled: false, time: '19:00' }, 3, '', at(2026, AUG, 10, 20))).toBe(false);
  });

  it('stays quiet when there is nothing left', () => {
    // The nudge is about unfinished work. A "well done, nothing to do" toast every
    // evening is exactly how a reminder earns itself a mute.
    expect(shouldFire(on, 0, '', at(2026, AUG, 10, 20))).toBe(false);
  });

  it('fires once a day and no more', () => {
    expect(shouldFire(on, 3, '2026-08-10', at(2026, AUG, 10, 20))).toBe(false);
    expect(shouldFire(on, 3, '2026-08-09', at(2026, AUG, 10, 20))).toBe(true);
  });

  it('does not fire again after midnight for the same logical day', () => {
    // 00:30 is still "the 10th" as far as the app is concerned (5am rollover), so
    // a reminder that already fired at 19:00 must not fire again an hour later.
    expect(shouldFire(on, 3, '2026-08-10', at(2026, AUG, 11, 0, 30))).toBe(false);
    // …and once the day genuinely turns over at 5am, it may.
    expect(shouldFire(on, 3, '2026-08-10', at(2026, AUG, 11, 19))).toBe(true);
  });

  it('still fires late for a device that was asleep at the hour', () => {
    // The check is "past the time", not "at the time" — a laptop opened at 22:00
    // should still be told, not skipped silently.
    expect(shouldFire(on, 3, '', at(2026, AUG, 10, 22, 45))).toBe(true);
  });

  it('never fires on an invalid time', () => {
    expect(shouldFire({ enabled: true, time: '99:99' }, 3, '', at(2026, AUG, 10, 23))).toBe(false);
  });
});

describe('reminderBody', () => {
  it('names the tasks rather than only counting them', () => {
    expect(reminderBody(2, ['Read 15 mins', 'Gym'])).toBe('Read 15 mins · Gym');
  });

  it('summarises the tail', () => {
    expect(reminderBody(5, ['Read', 'Gym', 'Water', 'Walk', 'Journal'])).toBe('Read · Gym · and 3 more');
  });

  it('falls back to a bare count when it has no titles', () => {
    expect(reminderBody(4, [])).toBe('4 still open today.');
  });
});
