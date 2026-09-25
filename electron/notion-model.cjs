// Pure projections, deliberately testable without Electron or a Notion account.
function richText(value = '') {
  const text = String(value);
  if (text.length > 190000) throw new Error('Text is too long for Notion; shorten it before exporting.');
  const chunks = [];
  for (let i = 0; i < text.length;) {
    let end = Math.min(i + 1900, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1])) end--;
    chunks.push({ type: 'text', text: { content: text.slice(i, end) } });
    i = end;
  }
  return chunks;
}

function questComplete(q) {
  if (q.completionMode === 'manual') return !!q.completed;
  const actions = q.actions.filter(a => !a.hidden);
  return actions.length ? actions.every(a => a.completed) : !!q.completed;
}

function recurrence(item) {
  if (item.monthlyRule) {
    const { nth, kind, months = 1 } = item.monthlyRule;
    const days = { day: 'day', weekday: 'weekday', weekend: 'weekend day', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
    return `${({ 1: 'First', 2: 'Second', 3: 'Third', 4: 'Fourth', '-1': 'Last' })[nth]} ${days[kind]} · every ${months === 1 ? 'month' : `${months} months`}`;
  }
  if (item.intervalDays) return `Every ${item.intervalDays} days`;
  return item.recurring ? item.recurring[0].toUpperCase() + item.recurring.slice(1) : 'Once';
}

const detailSchema = {
  'Milestone ID': { rich_text: {} },
  'Schedule': { rich_text: {} },
};
const taskSchema = {
  ...detailSchema,
  'Due': { date: {} },
  'Description': { rich_text: {} },
  'Progress': { rich_text: {} },
  'Questline': { rich_text: {} },
  'Quest': { rich_text: {} },
  'Skipped on': { date: {} },
};
function taskDetails(r, questlines) {
  const ql = questlines.find(q => q.id === r.questlineId);
  return {
    'Milestone ID': { rich_text: richText(r.id) },
    'Schedule': { rich_text: richText(recurrence(r)) },
    'Due': { date: r.dueDate ? { start: r.dueDate } : null },
    'Description': { rich_text: richText(r.description) },
    'Progress': { rich_text: richText(r.target != null ? `${r.progress ?? 0} / ${r.target}${r.unit ? ` ${r.unit}` : ''}` : r.completed ? 'Done' : 'Not done') },
    'Questline': { rich_text: richText(ql?.title) },
    'Quest': { rich_text: richText(ql?.quests.find(q => q.id === r.questId)?.title) },
    'Skipped on': { date: r.skippedOn ? { start: r.skippedOn } : null },
  };
}
module.exports = { richText, questComplete, recurrence, detailSchema, taskSchema, taskDetails };
