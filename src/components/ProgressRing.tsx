/** A progress ring in the water colour. Decorative: the caller names the value. */
export default function ProgressRing({ value, size = 44, stroke = 5, done = false, children }: {
  /** 0–1. */
  value: number; size?: number; stroke?: number;
  /** Closes the ring and draws a check inside it. */
  done?: boolean;
  children?: React.ReactNode;
}) {
  const radius = (44 - stroke) / 2 - 1.5;
  const length = 2 * Math.PI * radius;
  const share = done ? 1 : Math.max(0, Math.min(1, value));
  return (
    <svg className="progress-ring" aria-hidden="true" width={size} height={size} viewBox="0 0 44 44" data-done={done || undefined}>
      <circle className="progress-ring-track" cx="22" cy="22" r={radius} fill="none" strokeWidth={stroke} />
      {share > 0 && <circle className="progress-ring-fill" cx="22" cy="22" r={radius} fill="none" strokeWidth={stroke}
        strokeLinecap="round" strokeDasharray={`${(length * share).toFixed(1)} ${length.toFixed(1)}`} transform="rotate(-90 22 22)" />}
      {done && <path className="progress-ring-check" d="m15.5 22.5 4.5 4.5 8.5-9.5" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
      {children}
    </svg>
  );
}
