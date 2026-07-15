import { useEffect, useRef, useState } from 'react';
import { playClip } from './audio.js';

/**
 * The game's dialogue box, asking a question. Stands in for window.confirm.
 *
 * Modelled on the true ending's dialogue box, which is 1428x123 at x245 y939 on a 1080p
 * screen: black, a white hairline frame, the text left-aligned with a blinking block caret
 * after it, set in TT Chiaro. Sized in u = 1% of a 16:9 stage's height, so it scales with
 * the window like the picker.
 *
 * The answer is a cursor you move, as everything in this game is: Enter takes it, Escape
 * is always the cancelling one, and the blips are the picker's own cursor sounds.
 *
 * `defaultChoice` picks where the cursor rests: on something destructive (deleting the save,
 * throwing an ending away) that's the cancelling answer.
 */
export default function Confirm({
  question,
  confirmLabel = 'Yes',
  cancelLabel = 'No',
  defaultChoice = 1,
  onConfirm,
  onCancel,
  cursor,
}) {
  const [choice, setChoice] = useState(defaultChoice);
  const choiceRef = useRef(defaultChoice);
  const answers = [confirmLabel, cancelLabel];

  choiceRef.current = choice;

  const moveTo = (i) => {
    if (i === choiceRef.current) return;
    if (cursor?.move) playClip(cursor.move);
    choiceRef.current = i;
    setChoice(i);
  };

  const take = (i) => {
    if (cursor?.select) playClip(cursor.select);
    if (i === 0) onConfirm();
    else onCancel();
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') moveTo(0);
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') moveTo(1);
      else if (e.key === 'Enter') take(choiceRef.current);
      else if (e.key === 'Escape') onCancel();
      else return;
      e.preventDefault();
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="confirm" role="dialog" aria-modal="true" aria-label={question}>
      <div className="confirm-box">
        <p className="confirm-question">
          {question}
          <span className="confirm-caret" aria-hidden />
        </p>

        <div className="confirm-answers">
          {answers.map((label, i) => (
            <button
              type="button"
              key={label}
              className={`confirm-answer ${i === choice ? 'chosen' : ''}`}
              onMouseEnter={() => moveTo(i)}
              onClick={() => take(i)}
            >
              {/* the cursor marks the row rather than colouring it */}
              <span className="confirm-cursor" aria-hidden>
                ▸
              </span>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
