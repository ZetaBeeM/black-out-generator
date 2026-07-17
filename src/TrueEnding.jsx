import { useEffect } from 'react';
// tried recreating this by hand for a bit and yeah no
const VIDEO_ID = 'Ws3Co607Cv0';
const START_S = 520;
export default function TrueEnding({ onDone }) {
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
        title="The 25th Ward: The Silver Case — True Ending"
        allow="autoplay; encrypted-media; fullscreen"
        allowFullScreen
      />
      <button type="button" className="trueend-back" onClick={onDone}>
        Back
      </button>
    </div>
  );
}
