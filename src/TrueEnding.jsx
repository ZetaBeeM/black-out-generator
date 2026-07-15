import { useEffect } from 'react';

/**
 * The game's real ending, which the hundredth Blackout ending falls straight into, and
 * which the editor's Progress section can replay.
 *
 * An embedded video of the ending, played on black. This was a recreation once, with its
 * own script, assets and typewriter SFX; the embed replaced all of it, so nothing here is
 * timed or measured.
 */
const VIDEO_ID = 'Ws3Co607Cv0';
const START_S = 520; // where the true ending begins in the video

export default function TrueEnding({ onDone }) {
  // Escape leaves, as it does everywhere else here
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onDone();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);

  return (
    <div className="trueend">
      <iframe
        className="trueend-video"
        src={`https://www.youtube-nocookie.com/embed/${VIDEO_ID}?start=${START_S}&autoplay=1&rel=0`}
        title="The 25th Ward: The Silver Case — the true ending"
        allow="autoplay; encrypted-media; fullscreen"
        allowFullScreen
      />
      <button type="button" className="trueend-back" onClick={onDone}>
        Back
      </button>
    </div>
  );
}
