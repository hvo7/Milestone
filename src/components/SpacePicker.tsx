import { DEFAULT_SPACES, useQuestStore } from '../store';

export default function SpacePicker({ value, onChange, personal = true }: { value?: string; onChange: (id: string) => void; personal?: boolean }) {
  const spaces = useQuestStore(s => s.spaces ?? DEFAULT_SPACES);
  return <label style={{ display: 'grid', gap: 7, fontSize: 13 }}>Space
    <select className="rune-input" value={value ?? ''} onChange={e => onChange(e.target.value)}>
      {personal && <option value="">Personal / unassigned</option>}
      {spaces.filter(s => !s.archived || s.id === value).map(s => <option key={s.id} value={s.id}>{s.name}{s.archived ? ' (removed tab)' : ''}</option>)}
    </select>
  </label>;
}
