/**
 * Putting a Windows path into a PowerShell script without it changing meaning.
 *
 * Its own file, and tested (electron/psQuote.test.mjs), for exactly the reason
 * semver.cjs is: it sits on the path that replaces the application, and being
 * wrong here is invisible. The update simply never installs, which looks the
 * same from the outside as there being no update to install.
 *
 * What it replaces is `JSON.stringify`, which is *almost* right and reads as if
 * it were entirely right — it produces a quoted string with the backslashes
 * doubled, which is a correct JavaScript literal and a misleading PowerShell
 * one. Two things go wrong with it:
 *
 *   • It emits double quotes, and a double-quoted PowerShell string is the kind
 *     that interpolates. `$` starts a variable and a backtick starts an escape.
 *     Windows permits both in a directory name, so a profile or install path
 *     containing one expands to something else — usually to nothing, since the
 *     variable is undefined. The copy is then aimed at a path that does not
 *     exist, fails, retries five times, and gives up. Forever, on that machine,
 *     with nothing to show for it but a line in update.log.
 *   • The doubled backslashes survive only because Windows collapses repeated
 *     separators. They were never correct, and they made update.log — the one
 *     witness when an update goes wrong — read as though the path were mangled.
 *
 * Single quotes are PowerShell's literal string. Nothing inside them is
 * interpreted, and the only character that needs escaping is the quote itself,
 * written twice. That is the whole rule, which is the point of preferring it.
 */

/**
 * `C:\Users\me` → `'C:\Users\me'`, safe to paste into a PowerShell script.
 *
 * Nullish becomes an empty literal rather than the string "undefined": a script
 * that copies to `''` fails loudly on the next line, where one that copies to a
 * directory named "undefined" might well succeed.
 */
function psLiteral(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

module.exports = { psLiteral };
