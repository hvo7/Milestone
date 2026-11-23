import { useUIStore } from '../uiStore';
import pondArt from '../assets/pond.webp';
import bridgeArt from '../assets/bridge.webp';

/** Pond for Today and All; the bridge everywhere else. */
const bannerArt = (pathname: string): string =>
  pathname === '/' || pathname === '/all' ? pondArt : bridgeArt;

/**
 * The page's watercolour, as a card at the top of the content column. Purely
 * decorative. The only thing ever laid over it is the date pill on Today.
 * Renders nothing when "Show page art" is off, so no space is held for it.
 */
export default function PageBanner({ pathname, date }: { pathname: string; date?: { key: string; long: string; short: string } }) {
  const show = useUIStore(s => s.showPageArt) !== false;
  if (!show) return null;
  return (
    <div className="page-banner">
      <img src={bannerArt(pathname)} alt="" loading="lazy" decoding="async" />
      {date && <time className="page-banner-date" dateTime={date.key}>
        <span className="banner-date-long">{date.long}</span><span className="banner-date-short">{date.short}</span>
      </time>}
    </div>
  );
}
