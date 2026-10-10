import { useState } from 'react';
import { WarningScreen } from './WarningScreen';
import { Viewer } from './Viewer';

export function App() {
  const [accepted, setAccepted] = useState(false);
  return accepted ? <Viewer /> : <WarningScreen onAccept={() => setAccepted(true)} />;
}
