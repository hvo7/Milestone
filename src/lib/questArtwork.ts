/** Small, offline vector illustrations; no remote service or stored-data rewrite. */
const themes = [
  { key: 'books', match: /\b(book|read|reading|indistractable|atomic habits|friends|influence)\b/i, colors: ['#e7eddc', '#5b7552'], art: '<path d="M15 24q11-5 21 2 10-7 21-2v28q-11-4-21 2-10-6-21-2Z" fill="#fff9e9"/><path d="M36 26v28M20 31l10 1m-10 6 10 1m12-7 10-1m-10 8 10-1"/><path d="M46 22v14l4-3 4 2V22" fill="#dfa263"/>' },
  { key: 'language', match: /korean|hangul|language|conversation/i, colors: ['#ede6f5', '#75628f'], art: '<path d="M15 20h32a7 7 0 0 1 7 7v15H32l-10 9v-9h-7Z" fill="#fff9ee"/><path d="M28 26h13m-6-4v4m-9 9h17M35 27c0 7-6 11-10 12m9-9c2 5 6 8 11 9"/><path d="M43 47h14v11l-6-4h-8Z" fill="#d6b783"/>' },
  { key: 'skincare', match: /skin|serum|face wash|moisturi/i, colors: ['#f4e1e4', '#a16778'], art: '<path d="M28 17h16v10H28Z" fill="#b7cbb0"/><rect x="23" y="27" width="26" height="31" rx="7" fill="#fff6e4"/><path d="M29 27v-5h14v5M29 39h14m-11 6h8"/><path d="M55 20v8m-4-4h8M17 43q-7-8 0-15 7 7 0 15Z" fill="#b7cbb0"/>' },
  { key: 'cooking', match: /cook|recipe|taco|rice|beef|fan tuan|stir fry|wings|chicken|food/i, colors: ['#f4e8d5', '#9c724d'], art: '<path d="M17 36h39q-2 21-20 21T17 36Z" fill="#fff9e9"/><path d="M22 57h28M24 30q-5-5 0-10m11 10q-5-5 0-10m11 10q-5-5 0-10M51 35l10-16"/><path d="M22 36q8-9 15 0m-2 0q8-10 16 0" fill="#aac18e"/>' },
  { key: 'finance', match: /fire|financ|retire|money|earn|spend|invest|budget/i, colors: ['#e4eddc', '#637e55'], art: '<path d="M21 40h30l-4 18H25Z" fill="#e8bd76"/><path d="M36 40V22m0 10q-16 1-15-12 15-1 15 12m0 4q15 1 15-13-15 0-15 13" fill="#b6cc9b"/><circle cx="54" cy="19" r="8" fill="#f5d894"/><path d="M54 15v8m-2-6h4m-4 4h4"/>' },
  { key: 'fitness', match: /fit|gym|workout|exercise|strength|run|walk|health/i, colors: ['#deebe7', '#517b70'], art: '<path d="M24 32h24v9H24Z" fill="#d9b478"/><rect x="17" y="23" width="9" height="27" rx="3" fill="#fcf7e5"/><rect x="46" y="23" width="9" height="27" rx="3" fill="#fcf7e5"/><path d="M12 29v15m48-15v15M28 54q8 7 16 0"/>' },
  { key: 'gaming', match: /faceit|cs2|gaming|replay|train|crosshair/i, colors: ['#e0e8f2', '#576f91'], art: '<path d="M24 28h24q7 0 10 18 1 11-6 8l-10-8H30l-10 8q-7 3-6-8 3-18 10-18Z" fill="#faf5e5"/><path d="M25 34v10m-5-5h10M36 21v-5h8"/><circle cx="46" cy="35" r="2" fill="#b38365"/><circle cx="51" cy="41" r="2" fill="#88a98e"/>' },
  { key: 'data', match: /kaggle|python|pandas|program|code|stats|statistics|\bmas\b|data/i, colors: ['#e2eae9', '#527e80'], art: '<rect x="15" y="19" width="42" height="31" rx="4" fill="#fff9e9"/><path d="M12 55h48M28 29l-6 6 6 6m16-12 6 6-6 6m-6-14-4 16"/><circle cx="54" cy="18" r="6" fill="#dbb678"/>' },
  { key: 'study', match: /kris|embryo|leap|\bhp\b|study|assignment|course|learn|exam/i, colors: ['#e9e5da', '#84754f'], art: '<path d="m12 29 24-12 24 12-24 12Z" fill="#c0cfa7"/><path d="M22 35v13q14 10 28 0V35M59 30v18"/><path d="M20 57h32m-27-7v7m22-7v7"/>' },
  { key: 'quest', match: /./, colors: ['#e6e8e0', '#738268'], art: '<circle cx="36" cy="36" r="21" fill="#fff8e6"/><path d="m42 24-3 15-15 9 6-17Z" fill="#d4ad73"/><path d="m30 31 9 8M36 11v5m0 40v5M11 36h5m40 0h5"/>' },
] as const;

export function questArtwork(title: string, id: string, context = ''): string {
  const theme = themes.slice(0, -1).find(t => t.match.test(title))
    ?? themes.slice(0, -1).find(t => t.match.test(context)) ?? themes[themes.length - 1];
  const hash = [...id].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0);
  const hue = (hash % 19) - 9;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><rect width="72" height="72" rx="20" fill="${theme.colors[0]}"/><circle cx="56" cy="13" r="18" fill="#fff" opacity=".24"/><circle cx="12" cy="64" r="23" fill="${theme.colors[1]}" opacity=".06"/><g stroke="${theme.colors[1]}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" fill="none" style="filter:hue-rotate(${hue}deg)">${theme.art}</g><circle cx="${12 + hash % 5}" cy="15" r="2" fill="${theme.colors[1]}" opacity=".4"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
