import { useState } from 'react';
import { Disclaimer } from './Disclaimer';
import { Mark } from './Mark';

type Props = { onAccept: () => void };

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// The panel slides in from the right to the centre, and out to the left on continue.
// Movement only: no brightness change, nothing blinks.
export function WarningScreen({ onAccept }: Props) {
  const [leaving, setLeaving] = useState(false);

  function handleContinue() {
    if (reducedMotion()) onAccept();
    else setLeaving(true);
  }

  return (
    <main className="warning-screen">
      <section
        className={`warning ${leaving ? 'is-leaving' : ''}`}
        aria-labelledby="warning-title"
        onAnimationEnd={(e) => { if (e.animationName === 'warning-out') onAccept(); }}
      >
        <div className="brand"><Mark /> StrobeGuard</div>
        <h1 id="warning-title">This stream may contain flashing lights</h1>
        <p>
          StrobeGuard detects rapid flashing and filters the stream to reduce flash risk, but it
          cannot catch everything.
        </p>
        <p>If you have photosensitive epilepsy, keep your usual precautions:</p>
        <ul>
          <li>Watch in a well-lit room</li>
          <li>Sit back from the screen</li>
          <li>Stop watching if you feel unwell</li>
        </ul>
        <div className="warning-actions">
          <button className="primary" onClick={handleContinue} autoFocus>I understand, continue</button>
          <Disclaimer />
        </div>
      </section>
    </main>
  );
}
