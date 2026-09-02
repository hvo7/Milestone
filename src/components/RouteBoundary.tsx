/**
 * The thing that stands between a failed page load and a blank phone screen.
 *
 * Tabs other than Today arrive as their own chunk over the network (see
 * lib/lazyChunk.ts). When one of those requests fails, React's `lazy` throws —
 * and an error thrown with no boundary above it unmounts the entire app. That is
 * a black screen with nothing on it: no nav, no way back, nothing to tap. The
 * only recovery was to kill the app and reopen it, which is why the other tabs
 * looked like they simply didn't work.
 *
 * Catching it here keeps the nav bar rendered, so the tabs that *did* load are
 * still one tap away, and puts an explanation where the page should have been.
 * It catches a page's own render errors too — same argument: whatever is wrong
 * with Quests should not be able to take Today down with it.
 */
import { Component, useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import NavBar from './NavBar';

/** What the failure was, in the user's terms rather than the stack's. */
function RouteFailed() {
  // Offline is the common case on a phone and reads very differently from a
  // broken build, so it gets its own wording.
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;

  useEffect(() => {
    // If this was the network, the moment there is one again the reload that
    // fixes it costs nothing — there is no unsaved work on an error screen.
    const retry = () => window.location.reload();
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, []);

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: '48px 20px 60px' }}>
      <div className="parchment glass-card" style={{ borderRadius: 16, padding: '22px 24px' }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--page-text)' }}>
          This tab didn’t load
        </h2>
        <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6 }}>
          {offline
            ? 'You’re offline, and this part of the app hasn’t been downloaded to this device yet. It’ll open on its own once you’re back on a network.'
            : 'The page couldn’t be fetched. Reloading usually picks it up — your data is untouched either way, it lives on this device.'}
        </p>

        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          {/* A reload, not a re-render: React caches a failed `lazy` rejection
              for the life of the page, so trying the same component again in
              the same document would only re-throw the error we just caught. */}
          <button className="btn-gold" style={{ flex: '1 1 160px' }} onClick={() => window.location.reload()}>
            Try again
          </button>
          {/* Today ships in the main bundle, so it is the one page guaranteed to
              still be here whatever the network is doing. */}
          <Link to="/" style={{ flex: '1 1 160px', textDecoration: 'none' }}>
            <button className="btn-ghost" style={{ width: '100%' }}>Back to Today</button>
          </Link>
        </div>
      </div>
    </div>
  );
}

interface Props {
  /** Changes on every navigation, including one back to the page that failed.
   *  Any navigation deserves a fresh attempt — being stuck on the error for a
   *  page you've already left would be the blank screen again, only with words
   *  on it, and tapping the same tab a second time is the obvious way to ask
   *  for another go. */
  resetKey: string;
  children: ReactNode;
}

interface State { failed: boolean; shownFor: string }

export default class RouteBoundary extends Component<Props, State> {
  state: State = { failed: false, shownFor: '' };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  /** Cleared *before* the render rather than after it, so a navigation away
   *  from a failed page never paints the error one last time on the way out. */
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey === state.shownFor) return null;
    return { failed: false, shownFor: props.resetKey };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <>
        <NavBar />
        <RouteFailed />
      </>
    );
  }
}
