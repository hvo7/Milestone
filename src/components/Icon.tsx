/**
 * The interface's one icon set: inline SVG, 24px grid, 2px round strokes, drawn
 * in `currentColor`. Decorative by default — an icon-only button carries its own
 * `aria-label` and tooltip.
 */
const PATHS = {
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
  reload: <><path d="M20 5v5h-5" /><path d="M20 10a8 8 0 1 0-1.5 7" /></>,
  settings: <><path d="M4 6h8m6 0h2M4 12h2m6 0h8M4 18h10m6 0h0" /><circle cx="15" cy="6" r="2.5" /><circle cx="9" cy="12" r="2.5" /><circle cx="17" cy="18" r="2.5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  check: <path d="m5 12 5 5 9-10" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  grip: <><circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" /></>,
  chevron: <path d="m9 6 6 6-6 6" />,
  leaf: <><path d="M12 21v-9" /><path d="M12 12q-1-6-7-6 0 6 7 6Zm0 0q1-7 8-7 0 7-8 7Z" /></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  pin: <><path d="M9 4h6l-1 6 3 3H7l3-3Z" /><path d="M12 13v7" /></>,
  edit: <path d="M4 20h4L19 9l-4-4L4 16Z" />,
  back: <path d="m15 6-6 6 6 6" />,
  trash: <><path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
  pond: <><path d="M3 18q3-3 6 0t6 0 6 0" /><path d="M8 14q1-8 8-9-1 7-8 9Z" /></>,
} as const;

export type IconName = keyof typeof PATHS;

export default function Icon({ name, size = 18, strokeWidth = 2 }: { name: IconName; size?: number; strokeWidth?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flex: 'none' }}>
      {PATHS[name]}
    </svg>
  );
}
