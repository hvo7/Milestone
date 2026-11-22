export function DaySwitcher({ preview, onChange }: {
  preview: boolean;
  onChange: (preview: boolean) => void;
}) {
  return (
    <div className="agenda-switch" role="group" aria-label="Planning day">
      <button type="button" aria-pressed={!preview} onClick={() => onChange(false)}>Today</button>
      <button type="button" aria-pressed={preview} onClick={() => onChange(true)}>Tomorrow</button>
    </div>
  );
}

export function DayProgress({ done, total }: { done: number; total: number }) {
  const percent = total ? Math.round(100 * done / total) : 0;
  return (
    <section className="agenda-progress" aria-labelledby="agenda-progress-label">
      <div className="agenda-progress-line">
        <h2 id="agenda-progress-label">Day progress</h2>
        <span>{percent}%</span>
      </div>
      <progress aria-labelledby="agenda-progress-label" value={done} max={total || 1} />
      <p>{total ? `${done} of ${total} complete` : 'Nothing scheduled'}</p>
    </section>
  );
}
