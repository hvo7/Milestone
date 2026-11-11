import { reserveSyncRequest } from './syncBudget';
/** Push transports share one lifecycle. Polling remains active when either fails. */
export function watchSyncPush(options: {
  health: () => Promise<{ push?: string }>;
  eventsUrl: string;
  changed: () => void;
  connected: (live: boolean) => void;
}) {
  let stopped = false;
  let socket: WebSocket | null = null;
  let stream: EventSource | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;
  let usesSocket = false;

  const openSocket = () => {
    if (stopped || typeof WebSocket === 'undefined') return;
    const url = new URL(options.eventsUrl, location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const reconnect = () => {
      options.connected(false);
      if (!stopped && !retry) retry = setTimeout(() => {
        retry = null; openSocket();
      }, Math.min(30_000, 1000 * 2 ** Math.min(attempts++, 5)));
    };
    try {
      reserveSyncRequest(url.toString());
      socket = new WebSocket(url.toString());
      socket.onopen = () => { attempts = 0; options.connected(true); options.changed(); };
      socket.onmessage = event => {
        try { if (JSON.parse(event.data).type === 'changed') options.changed(); } catch { /* Ignore malformed notifications. */ }
      };
      socket.onclose = reconnect;
      socket.onerror = () => { options.connected(false); socket?.close(); };
    } catch { reconnect(); }
  };

  const onResume = () => {
    if (!usesSocket || stopped || document.hidden) return;
    if (!socket || socket.readyState === WebSocket.CLOSED) {
      if (retry) clearTimeout(retry);
      retry = null; openSocket();
    }
    options.changed();
  };
  window.addEventListener('online', onResume);
  document.addEventListener('visibilitychange', onResume);

  const discover = () => options.health().catch(() => {
    // Offline launch must discover WebSocket support when the network returns,
    // not permanently fall back to an unsupported SSE endpoint.
    if (!stopped) retry = setTimeout(() => { retry = null; void discover(); }, 60_000);
    return null;
  }).then(health => {
    if (stopped || !health || typeof health !== 'object') return;
    usesSocket = 'push' in health && health.push === 'websocket';
    if (usesSocket) { openSocket(); return; }
    if (typeof EventSource === 'undefined') return;
    try {
      stream = new EventSource(options.eventsUrl);
      stream.addEventListener('changed', options.changed);
      stream.onopen = () => { options.connected(true); options.changed(); };
      stream.onerror = () => options.connected(false);
    } catch { options.connected(false); }
  });
  void discover();

  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    if (socket) {
      socket.onopen = socket.onclose = socket.onerror = socket.onmessage = null;
      socket.close();
    }
    if (stream) {
      stream.onopen = stream.onerror = null;
      stream.close();
    }
    window.removeEventListener('online', onResume);
    document.removeEventListener('visibilitychange', onResume);
  };
}
