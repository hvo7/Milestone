import { useRef, useState } from 'react';
import QuestIcon from './QuestIcon';
import { resizeToDataUrl, pasteImageFromClipboard } from '../lib/iconUtils';

interface Props {
  value: string;
  onChange: (icon: string) => void;
}

/**
 * Minimal icon picker: preview tile + emoji text input + image upload/paste.
 * Images are resized and stored as base64 data URLs in the same string field.
 */
export default function IconPicker({ value, onChange }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');

  const isImage = value.startsWith('data:') || value.startsWith('blob:');

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    resizeToDataUrl(file).then(url => { if (url) onChange(url); });
    e.target.value = '';
  }

  async function handlePaste() {
    setMsg('');
    const url = await pasteImageFromClipboard();
    if (url) onChange(url);
    else setMsg('No image in clipboard — copy one first, then click Paste.');
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
        {/* Preview tile */}
        <div style={{
          width: 52, height: 52, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--input-bg)',
          border: '1px solid var(--input-border)',
          borderRadius: 10,
        }}>
          {value
            ? <QuestIcon icon={value} size={32} style={{ borderRadius: 6 }} />
            : <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>—</span>}
        </div>

        {/* Controls */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {!isImage && (
            <input
              className="rune-input"
              placeholder="Type or paste an emoji (optional)"
              value={value}
              onChange={e => onChange(e.target.value)}
              style={{ fontSize: 15, padding: '5px 10px' }}
            />
          )}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className="btn-ghost" onClick={() => fileRef.current?.click()} style={{ fontSize: 12, padding: '4px 10px' }}>
              Upload image
            </button>
            <button type="button" className="btn-ghost" onClick={handlePaste} style={{ fontSize: 12, padding: '4px 10px' }}>
              Paste image
            </button>
            {value && (
              <button
                type="button"
                onClick={() => onChange('')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-dim)', padding: '4px 6px' }}
              >
                Remove
              </button>
            )}
          </div>
        </div>
      </div>

      {msg && <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--danger)' }}>{msg}</p>}
      <input ref={fileRef} type="file" accept="image/*" onChange={handleFileUpload} style={{ display: 'none' }} />
    </div>
  );
}
