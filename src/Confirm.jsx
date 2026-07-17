import { useEffect, useRef, useState } from 'react';
import { playClip } from './audio.js';

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
              {}
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