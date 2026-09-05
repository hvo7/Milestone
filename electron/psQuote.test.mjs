/**
 * The quoting that decides whether the swap script points at the real install.
 *
 * Every case here is one where being wrong costs nothing visible at the moment
 * it happens. The script still runs, still logs, still reports that it tried —
 * it just copies the new build somewhere that isn't the application, so the app
 * goes on being the version it was. That is indistinguishable from having no
 * updater, which is the state this whole mechanism exists to leave behind.
 */
import { describe, it, expect } from 'vitest';
import psQuote from './psQuote.cjs';

const { psLiteral } = psQuote;

describe('psLiteral', () => {
  it('wraps an ordinary Windows path in single quotes', () => {
    expect(psLiteral('C:\\Users\\henry\\AppData\\Local\\Milestone'))
      .toBe("'C:\\Users\\henry\\AppData\\Local\\Milestone'");
  });

  // The bug this file was written for. JSON.stringify produced doubled
  // backslashes, which Windows tolerates by collapsing them, so the mistake
  // survived every test that only asked whether the copy worked.
  it('leaves backslashes alone rather than doubling them', () => {
    const quoted = psLiteral('C:\\Program Files\\Milestone');
    expect(quoted).not.toContain('\\\\');
    expect(quoted).toBe("'C:\\Program Files\\Milestone'");
  });

  // The half of that bug that actually breaks installs. In a double-quoted
  // PowerShell string `$env` is a variable; in a single-quoted one it is four
  // characters, which is what a directory called `$env` needs to be.
  it('does not let a dollar sign become a variable', () => {
    expect(psLiteral('C:\\Users\\a$env\\Milestone'))
      .toBe("'C:\\Users\\a$env\\Milestone'");
    expect(psLiteral('C:\\$staged\\app')).toBe("'C:\\$staged\\app'");
  });

  // Backtick is PowerShell's escape character, so `\t` inside double quotes
  // would have become a tab. Windows allows a backtick in a folder name.
  it('does not let a backtick escape anything', () => {
    expect(psLiteral('C:\\Users\\me`t\\Milestone')).toBe("'C:\\Users\\me`t\\Milestone'");
  });

  // The one character single quoting does care about. Windows allows an
  // apostrophe in a user name, so this is a real path, not a hypothetical one.
  it("doubles an embedded apostrophe so it stays inside the string", () => {
    expect(psLiteral("C:\\Users\\O'Brien\\Milestone"))
      .toBe("'C:\\Users\\O''Brien\\Milestone'");
  });

  it('leaves double quotes untouched, since they are not special here', () => {
    expect(psLiteral('C:\\a"b')).toBe("'C:\\a\"b'");
  });

  it('gives an empty literal for nothing at all', () => {
    expect(psLiteral(undefined)).toBe("''");
    expect(psLiteral(null)).toBe("''");
  });
});
