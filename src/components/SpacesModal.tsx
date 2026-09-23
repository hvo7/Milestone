import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DEFAULT_SPACES, useQuestStore } from '../store';
import ModalShell from './ModalShell';
import type { Space } from '../types';

function SpaceRow({ space }: { space: Space }) {
  const update = useQuestStore(s => s.updateSpace);
  const [name, setName] = useState(space.name);
  const spaces = useQuestStore(s => s.spaces ?? DEFAULT_SPACES);
  const valid = !!name.trim() && !spaces.some(s => s.id !== space.id && s.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase());
  return <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
    <input className="rune-input" aria-label={`Name for ${space.name}`} value={name} onChange={e => setName(e.target.value)} style={{ flex: '1 1 160px' }} maxLength={60} />
    <button className="btn-ghost" disabled={!valid || name.trim() === space.name} onClick={() => update(space.id, { name })}>Rename</button>
    <button className="btn-ghost" onClick={() => update(space.id, { archived: !space.archived })}>{space.archived ? 'Restore tab' : 'Remove tab'}</button>
    {!valid && <small role="alert">Use a unique, non-empty name.</small>}
  </div>;
}

export default function SpacesModal({ onClose }: { onClose: () => void }) {
  const spaces = useQuestStore(s => s.spaces ?? DEFAULT_SPACES);
  const add = useQuestStore(s => s.addSpace);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  useEffect(() => {
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);
  return <ModalShell onClose={onClose}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h2>Manage spaces</h2><button className="btn-ghost" onClick={onClose} aria-label="Close manage spaces">✕</button></div>
    <p>A tab for each company, team, or part of your life. Each space holds its own questlines, systems, and projects.</p>
    <form onSubmit={e => { e.preventDefault(); const id = add(name); if (!id) return setError('Choose a unique name, or restore the existing tab below.'); navigate(`/spaces/${id}`); onClose(); }}>
      <label>New space<input className="rune-input" autoFocus placeholder="e.g. Basketball coaching" value={name} maxLength={60} onChange={e => { setName(e.target.value); setError(''); }} /></label>
      {error && <p role="alert">{error}</p>}
      <button className="btn-gold" style={{ marginTop: 12 }} disabled={!name.trim()}>Create tab</button>
    </form>
    <p style={{ marginTop: 24 }}>Removing a tab keeps its contents in Today, Quests, Systems, and All. Restore it here anytime.</p>
    {spaces.map(space => <SpaceRow key={space.id + space.name} space={space} />)}
  </ModalShell>;
}
