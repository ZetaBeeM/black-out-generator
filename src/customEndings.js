/**
 * The endings the player writes themselves, kept in localStorage.
 *
 * Deliberately a separate store from progress.js and from endings.json: these are not part
 * of the game's hundred, they don't colour in as watched, and they can never complete the
 * set or trigger the true ending. The picker shows them on their own deck (left/right
 * switches between the two), listed the same way — the same cylinder, the same rows.
 *
 * A custom ending keeps its colours as well as its lines, since the colours are part of
 * what the player made.
 */
const KEY = 'blackout.custom.v1';

const MAX_LABEL = 96; // a name longer than the list scrolls; past this it's just unreadable

/** The label is the chain's first line, exactly as the game's own endings are named. */
const labelFor = (entries) => {
  const first = entries.find((e) => e.text.trim())?.text.trim() ?? 'Untitled';
  return first.length > MAX_LABEL ? `${first.slice(0, MAX_LABEL - 1)}…` : first;
};

export function loadCustom() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(list)) return [];
    // trust nothing that came out of storage: a malformed entry shouldn't reach the layout
    return list.filter(
      (e) => e && typeof e.number === 'string' && Array.isArray(e.entries) && e.entries.length > 0,
    );
  } catch {
    return []; // private mode, or junk under the key
  }
}

/**
 * Writes the list, or throws.
 *
 * A failed write used to be swallowed and the list handed back anyway, which meant the
 * editor said "Saved" over an ending that had gone nowhere: it sat there in the picker until
 * the page was reloaded, and then it was simply gone. Storage being full or unavailable
 * (Safari's private mode has no localStorage at all, and that's the common case, not a full
 * quota) mustn't take the app down — but it has to be *said*, not hidden. So every write
 * throws on failure and the caller reports it.
 */
function persist(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    throw new Error("Couldn't save — storage is full or unavailable.");
  }
  return list;
}

/**
 * Saves a chain as a new custom ending and returns the list it now belongs to. The number is
 * only ever an identity — it's what the picker keys rows on — so it's monotonic rather than
 * an index: deleting an ending must not renumber the others under the cursor.
 */
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
      custom: true, // what the rest of the app checks: this one is not the game's
    },
  ]);
}

/**
 * Writes a chain back over the ending it was loaded from, keeping its number (and so its
 * place in the list, and any link already sent for it). Without this, editing one of your
 * own endings and saving it grew a second copy under the same name.
 */
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

/**
 * The player's endings, as a file.
 *
 * localStorage is one "clear site data" away from gone, and these are the only thing in the
 * app the player actually wrote — so they need a way to hold onto them, and to carry them
 * between browsers.
 */
export function exportCustom() {
  return JSON.stringify({ format: 'blackout.custom', version: 1, endings: loadCustom() }, null, 2);
}

/**
 * Adds the endings in a file to the ones already saved, rather than replacing them: an
 * import shouldn't be able to wipe work that's already here. Everything imported is
 * renumbered onto the end of the list, so two files that both start at 001 don't collide.
 *
 * Returns { list, added }, or throws if the file isn't one of ours.
 */
export function importCustom(text) {
  const data = JSON.parse(text);
  const incoming = Array.isArray(data) ? data : data?.endings;
  if (!Array.isArray(incoming)) throw new Error('Not a Blackout endings file.');

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
