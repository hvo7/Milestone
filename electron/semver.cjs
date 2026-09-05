/**
 * "Is the published version newer than the one running?"
 *
 * Its own file, and tested (electron/semver.test.mjs), because it is the single
 * decision the updater makes that can go wrong quietly. A comparison that is
 * merely *wrong* either offers an update that isn't one — visible, annoying,
 * harmless — or silently never offers a real one, which looks exactly like an
 * app that has no updater at all. The obvious implementation, comparing the
 * strings, does the second one the moment a version reaches 3.0.10: "3.0.10" is
 * lexically less than "3.0.9", so that release would never install anywhere.
 *
 * Plain numeric semver, because that is all this project publishes. A
 * pre-release suffix has never been released, and inventing handling for one
 * would be untested code on the path that replaces the application.
 */

/** `3.0.4` → `[3, 0, 4]`, tolerating a leading `v` and anything malformed. */
function parts(version) {
  return String(version ?? '')
    .trim()
    .replace(/^v/i, '')
    .split('.')
    .map(n => parseInt(n, 10) || 0);
}

/** True when `a` is a strictly later version than `b`. Missing or unparseable
 *  input is never "newer": the safe answer is to leave the app alone. */
function isNewer(a, b) {
  if (!a || !b) return false;
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) {
    if ((x[i] || 0) > (y[i] || 0)) return true;
    if ((x[i] || 0) < (y[i] || 0)) return false;
  }
  return false;
}

module.exports = { isNewer };
