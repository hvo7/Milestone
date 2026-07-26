interface Props {
  icon: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  /** Set false to render an image icon without its backing plate. */
  plate?: boolean;
}

/** Renders a questline icon — either a base64/URL image or an emoji string. */
export default function QuestIcon({ icon, size = 22, className = '', style, plate = true }: Props) {
  if (!icon) return null;

  const isImage = icon.startsWith('data:') || icon.startsWith('blob:') || icon.startsWith('http');
  if (isImage) {
    // Uploaded images can be dark and vanish against the dark card background.
    // A light backing plate (see .icon-plate in index.css) keeps any icon legible
    // in both themes. The outer box stays exactly `size` so layouts don't shift.
    const pad = plate ? Math.max(1, Math.round(size * 0.12)) : 0;
    return (
      <span
        className={`${plate ? 'icon-plate' : ''} ${className}`.trim()}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          padding: pad,
          flexShrink: 0,
          verticalAlign: 'middle',
          borderRadius: 4,
          ...style,
        }}
      >
        <img
          src={icon}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'contain', imageRendering: 'auto' }}
        />
      </span>
    );
  }

  return (
    <span style={{ fontSize: size, lineHeight: 1, ...style }} className={className}>
      {icon}
    </span>
  );
}
