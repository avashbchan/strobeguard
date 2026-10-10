import { Disclaimer } from './Disclaimer';

type Props = { onAccept: () => void };

export function WarningScreen({ onAccept }: Props) {
  return (
    <main className="warning">
      <h1>StrobeGuard</h1>
      <h2>Photosensitivity warning</h2>
      <p>
        Livestreams can contain flashing lights and patterns. StrobeGuard detects rapid flashing
        and filters the stream to reduce flash risk, but it cannot catch everything.
      </p>
      <p>
        If you have photosensitive epilepsy, keep your usual precautions: watch in a well-lit room,
        sit back from the screen, and stop watching if you feel unwell.
      </p>
      <Disclaimer />
      <button onClick={onAccept}>I understand — continue</button>
    </main>
  );
}
