import { useRef, useState, useEffect, useCallback } from 'react';
import { hexToHsv, hsvToHex, isValidHex, normalizeHex } from '../lib/color';

interface Props { value: string; onChange: (hex: string) => void; }

const PRESETS = [
  '#f87171', '#fb923c', '#fbbf24', '#34d399',
  '#22d3ee', '#60a5fa', '#a78bfa', '#f472b6',
];

/** Drag within an element and keep receiving pointer moves even if the cursor
 *  leaves it, until pointerup. `onMove` gets 0..1 fractions clamped to the box. */
function useDragBox(onMove: (fx: number, fy: number) => void) {
  const ref = useRef<HTMLDivElement>(null);

  const fromEvent = useCallback((e: PointerEvent | React.PointerEvent) => {
    const box = ref.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const fy = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    onMove(fx, fy);
  }, [onMove]);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    fromEvent(e);
    const move = (ev: PointerEvent) => fromEvent(ev);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return { ref, onPointerDown };
}

/**
 * Saturation/value square + hue slider ("hex drag gradient") plus a hex input
 * and quick-pick presets. Stores the raw hex directly on the questline.
 */
export default function ColorPicker({ value, onChange }: Props) {
  const { h, s, v } = hexToHsv(value || '#a78bfa');
  const [hue, setHue] = useState(h);
  const [hexDraft, setHexDraft] = useState(value);

  useEffect(() => { setHexDraft(value); }, [value]);

  const square = useDragBox((fx, fy) => {
    onChange(hsvToHex(hue, fx, 1 - fy));
  });
  const slider = useDragBox((fx) => {
    const nextHue = fx * 360;
    setHue(nextHue);
    onChange(hsvToHex(nextHue, s, v));
  });

  function commitHex() {
    if (isValidHex(hexDraft)) {
      const norm = normalizeHex(hexDraft);
      onChange(norm);
      setHue(hexToHsv(norm).h);
    } else {
      setHexDraft(value);
    }
  }

  const thumbHex = hsvToHex(hue, 1, 1);

  return (
    <div>
      {/* Presets */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {PRESETS.map(hex => (
          <button
            key={hex}
            type="button"
            onClick={() => { onChange(hex); setHue(hexToHsv(hex).h); }}
            style={{
              width: 24, height: 24, borderRadius: '50%', background: hex, cursor: 'pointer',
              border: '2px solid var(--card-bg)',
              outline: normalizeHex(value) === hex ? `2px solid ${hex}` : '2px solid transparent',
              outlineOffset: 1,
              transition: 'outline-color 0.15s',
            }}
          />
        ))}
      </div>

      {/* Saturation/value square */}
      <div
        ref={square.ref}
        onPointerDown={square.onPointerDown}
        style={{
          position: 'relative', width: '100%', height: 120, borderRadius: 10,
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hsvToHex(hue, 1, 1)})`,
          cursor: 'crosshair', touchAction: 'none', marginBottom: 10,
          border: '1px solid var(--card-border)',
        }}
      >
        <div style={{
          position: 'absolute', left: `${s * 100}%`, top: `${(1 - v) * 100}%`,
          width: 14, height: 14, borderRadius: '50%',
          border: '2px solid white', boxShadow: '0 0 0 1px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.3)',
          transform: 'translate(-50%, -50%)', background: value, pointerEvents: 'none',
        }} />
      </div>

      {/* Hue slider */}
      <div
        ref={slider.ref}
        onPointerDown={slider.onPointerDown}
        style={{
          position: 'relative', width: '100%', height: 14, borderRadius: 999,
          background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
          cursor: 'pointer', touchAction: 'none', marginBottom: 12,
        }}
      >
        <div style={{
          position: 'absolute', left: `${(hue / 360) * 100}%`, top: '50%',
          width: 18, height: 18, borderRadius: '50%',
          border: '2px solid white', boxShadow: '0 0 0 1px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.3)',
          transform: 'translate(-50%, -50%)', background: thumbHex, pointerEvents: 'none',
        }} />
      </div>

      {/* Hex input */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 26, height: 26, borderRadius: 6, background: value, border: '1px solid var(--card-border)', flexShrink: 0 }} />
        <input
          className="rune-input"
          value={hexDraft}
          onChange={e => setHexDraft(e.target.value)}
          onBlur={commitHex}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          placeholder="#a78bfa"
          style={{ flex: 1, fontSize: 13, padding: '5px 10px', fontFamily: 'monospace' }}
        />
      </div>
    </div>
  );
}
