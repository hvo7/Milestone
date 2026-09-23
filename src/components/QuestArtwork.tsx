import QuestIcon from './QuestIcon';
import { questArtwork } from '../lib/questArtwork';

export default function QuestArtwork({ title, id, context, icon = '', size = 32, style }: {
  title: string; id: string; context?: string; icon?: string; size?: number; style?: React.CSSProperties;
}) {
  // Batch 001: explicitly approved for production.
  const customImage = /^(data:|blob:|https?:)/.test(icon);
  return <span data-quest-artwork title={`${title} · ${customImage ? 'custom artwork' : 'illustrated icon'}`} style={{ display: 'inline-flex', flexShrink: 0, ...style }}>
    <QuestIcon icon={customImage ? icon : questArtwork(title, id, context)} size={Math.max(size, 36)} plate={false} />
  </span>;
}
