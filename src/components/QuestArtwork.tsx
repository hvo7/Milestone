import QuestIcon from './QuestIcon';
import { questArtwork } from '../lib/questArtwork';

export default function QuestArtwork({ title, id, context, icon = '', size = 32, style, kind = 'system' }: {
  title: string; id: string; context?: string; icon?: string; size?: number; style?: React.CSSProperties;
  kind?: 'quest' | 'questline' | 'system';
}) {
  // Batch 002: approved for production. Artwork belongs to the questline.
  if (kind === 'quest') return null;
  const replacePicture = kind === 'questline' && /^(get fit|read 5 books)$/i.test(title.trim());
  const customImage = !replacePicture && /^(data:|blob:|https?:)/.test(icon);
  return <span data-quest-artwork title={`${title} · ${customImage ? 'custom artwork' : 'illustrated icon'}`} style={{ display: 'inline-flex', flexShrink: 0, ...style }}>
    <QuestIcon icon={customImage ? icon : questArtwork(title, id, context)} size={Math.max(size, 36)} plate={false} />
  </span>;
}
