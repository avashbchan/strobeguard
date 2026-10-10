import { Disclaimer } from './Disclaimer';
import { Logo } from './Logo';

type Props = { leaving: boolean; onAccept: () => void; onLeft: () => void };

// Slides in from the right on load; on continue it slides out to the left, then App shows the
// viewer. Under prefers-reduced-motion the CSS animations are off and App switches instantly.
export function WarningScreen({ leaving, onAccept, onLeft }: Props) {
  return (
    <div className="warning-backdrop">
      <main
        className={'warning' + (leaving ? ' leaving' : '')}
        aria-labelledby="warning-title"
        onAnimationEnd={(e) => { if (leaving && e.target === e.currentTarget) onLeft(); }}
      >
        <div className="brand"><Logo /> StrobeGuard</div>
        <h1 id="warning-title">This stream may contain flashing lights</h1>
        <p>StrobeGuard detects rapid flashing and filters the stream to reduce flash risk, but it cannot catch everything.</p>
        <p>If you have photosensitive epilepsy, keep your usual precautions:</p>
        <ul className="precautions">
          <li>Watch in a well-lit room</li>
          <li>Sit back from the screen</li>
          <li>Stop watching if you feel unwell</li>
        </ul>
        <div className="warning-actions">
          <button className="primary" onClick={onAccept} disabled={leaving} autoFocus>I understand, continue</button>
          <Disclaimer />
        </div>
      </main>
    </div>
  );
}
