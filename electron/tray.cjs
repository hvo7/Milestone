/**
 * Tray icon and desktop notifications.
 *
 * The renderer decides *whether* to nudge — it's the only side that can read the
 * stores — so everything here is display: show this text, show this count.
 *
 * The tray exists mainly so "3 left today" is answerable without opening
 * anything, and so a reminder can still arrive once the window is closed. That
 * second part is opt-in (`keepInTray`): an app that silently refuses to quit when
 * you press ✕ is a bad citizen, so it only holds on when the user has asked it to.
 */
const { app, Tray, Menu, Notification, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

let tray = null;
let showWindow = () => {};
/** True while the user has asked us to keep running after the window closes. */
let keepInTray = false;
/** Set by main.cjs on `before-quit`, so the close handler can tell a real quit
 *  from a window close it is supposed to intercept. */
let quitting = false;

/**
 * The app icon on disk.
 *
 * `--extra-resource=build/icon.ico` in the packaging script is what puts it
 * beside the exe; without that this returns a path that doesn't exist and the
 * tray silently never appears — which is exactly how a tray feature dies unnoticed.
 */
function iconFile() {
  const packaged = path.join(process.resourcesPath ?? '', 'icon.ico');
  if (app.isPackaged && fs.existsSync(packaged)) return packaged;
  const dev = path.join(__dirname, '..', 'build', 'icon.ico');
  return fs.existsSync(dev) ? dev : null;
}

function ensureTray() {
  if (tray) return tray;
  const file = iconFile();
  if (!file) return null;
  const image = nativeImage.createFromPath(file);
  // An empty image produces a tray entry that occupies space and shows nothing.
  // Better to have no tray than an invisible one the user can't click.
  if (image.isEmpty()) return null;

  tray = new Tray(image);
  tray.setToolTip('Milestone');
  tray.on('click', () => showWindow());
  return tray;
}

function rebuildMenu(count) {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: count > 0 ? `${count} still open today` : 'Nothing left today', enabled: false },
    { type: 'separator' },
    { label: 'Open Milestone', click: () => showWindow() },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
}

/** Called from the renderer whenever the count or the setting changes. */
function update({ count = 0, keepInTray: keep = false } = {}) {
  keepInTray = !!keep;

  // No tray wanted and none showing: nothing to do. (The tray is kept while the
  // window is open even without `keepInTray` — the count is useful either way.)
  const t = ensureTray();
  if (!t) return { ok: false, error: 'Tray icon unavailable.' };

  t.setToolTip(count > 0 ? `Milestone — ${count} still open today` : 'Milestone — all clear');
  rebuildMenu(count);
  return { ok: true };
}

/** Show a desktop notification. Returns false when the OS has them switched off,
 *  so the renderer can say so rather than silently doing nothing. */
function notify(title, body) {
  if (!Notification.isSupported()) return { ok: false, error: 'Notifications are not available on this system.' };
  const file = iconFile();
  const n = new Notification({ title, body, ...(file ? { icon: file } : {}) });
  // A notification you can't act on is half a feature.
  n.on('click', () => showWindow());
  n.show();
  return { ok: true };
}

/** Wire the tray to the window. Called once, from main.cjs. */
function init(show) {
  showWindow = show;
}

module.exports = {
  init,
  update,
  notify,
  /** Should a window close be intercepted and turned into a hide? */
  shouldHideOnClose: () => keepInTray && !quitting,
  markQuitting: () => { quitting = true; },
};
