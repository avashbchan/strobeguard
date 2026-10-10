import { useState } from 'react';
import { WarningScreen } from './WarningScreen';
import { Viewer } from './Viewer';

type Phase = 'warning' | 'leaving' | 'viewer';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function App() {
  const [phase, setPhase] = useState<Phase>('warning');
  if (phase === 'viewer') return <Viewer />;
  return (
    <WarningScreen
      leaving={phase === 'leaving'}
      // With reduced motion there is no slide-out animation (and no animationend), so go straight on.
      onAccept={() => setPhase(reducedMotion() ? 'viewer' : 'leaving')}
      onLeft={() => setPhase('viewer')}
    />
  );
}
