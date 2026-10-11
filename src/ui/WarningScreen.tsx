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
        <h1 id="warning-title">Flash protection is on</h1>
        <p>
          StrobeGuard spots rapid flashing and filters it to reduce flash risk before it reaches
          your screen. In tests on real stream footage, it damped every second of flashing that
          EA’s IRIS photosensitivity analysis flagged.
        </p>
        <p>
          Triggers vary from person to person. If you have photosensitive epilepsy, keep your usual
          precautions and stop watching if you feel unwell.
        </p>
        <div className="warning-actions">
          <button className="primary" onClick={handleContinue} autoFocus>Start watching</button>
          <Disclaimer />
        </div>
      </section>
    </main>
  );
}
