import { useSyncExternalStore } from 'react';

const query = '(max-width: 760px)';
const snapshot = () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
const subscribe = (notify: () => void) => {
  const media = window.matchMedia?.(query);
  media?.addEventListener('change', notify);
  return () => media?.removeEventListener('change', notify);
};

/** Reacts to window resizing and phone rotation, without device-name detection. */
export const usePhoneLayout = () => useSyncExternalStore(subscribe, snapshot, () => false);
