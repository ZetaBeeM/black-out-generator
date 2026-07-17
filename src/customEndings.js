const KEY = 'blackout.custom.v1';
const MAX_LABEL = 96;
const labelFor = (entries) => {
  const first = entries.find((e) => e.text.trim())?.text.trim() ?? 'Untitled';
  return first.length > MAX_LABEL ? `${first.slice(0, MAX_LABEL - 1)}…` : first;
};
export function loadCustom() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(list)) return [];
    return list.filter(
      (e) => e && typeof e.number === 'string' && Array.isArray(e.entries) && e.entries.length > 0,
    );
  } catch {
    return [];
  }
}
function persist(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    throw new Error("Save failed.");
  }
  return list;
}

export function saveCustom({ entries, textColor, redColor }) {
  const lines = entries
    .filter((e) => e.text.trim())
    .map((e) => ({ text: e.text, red: !!e.red }));
  if (lines.length === 0) return loadCustom();
  const list = loadCustom();
  const highest = list.reduce((max, e) => Math.max(max, Number(e.number) || 0), 0);
  return persist([
    ...list,
    {
      number: String(highest + 1).padStart(3, '0'),
      label: labelFor(lines),
      entries: lines,
      colors: { textColor, redColor },
      saved: Date.now(),
      custom: true,
    },
  ]);
}
export function updateCustom(number, { entries, textColor, redColor }) {
  const lines = entries
    .filter((e) => e.text.trim())
    .map((e) => ({ text: e.text, red: !!e.red }));
  if (lines.length === 0) return loadCustom();

  return persist(
    loadCustom().map((ending) =>
      ending.number === number
        ? { ...ending, label: labelFor(lines), entries: lines, colors: { textColor, redColor }, saved: Date.now() }
        : ending,
    ),
  );
}
export function deleteCustom(number) {
  return persist(loadCustom().filter((e) => e.number !== number));
}
export function exportCustom() {
  return JSON.stringify({ format: 'blackout.custom', version: 1, endings: loadCustom() }, null, 2);
}
export function importCustom(text) {
  const data = JSON.parse(text);
  const incoming = Array.isArray(data) ? data : data?.endings;
  if (!Array.isArray(incoming)) throw new Error('File incompatible.');
  const clean = incoming
    .filter((e) => Array.isArray(e?.entries) && e.entries.some((line) => typeof line?.text === 'string'))
    .map((e) => ({
      entries: e.entries
        .filter((line) => typeof line?.text === 'string')
        .map((line) => ({ text: line.text, red: !!line.red })),
      colors: {
        textColor: e.colors?.textColor ?? '#cccccc',
        redColor: e.colors?.redColor ?? '#a01a20',
      },
      saved: typeof e.saved === 'number' ? e.saved : Date.now(),
    }));
  if (clean.length === 0) throw new Error('No endings in that file.');
  const list = loadCustom();
  let next = list.reduce((max, e) => Math.max(max, Number(e.number) || 0), 0);
  const added = clean.map((e) => ({
    ...e,
    number: String((next += 1)).padStart(3, '0'),
    label: labelFor(e.entries),
    custom: true,
  }));
  return { list: persist([...list, ...added]), added: added.length };
}
