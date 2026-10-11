import { useId } from 'react';

/**
 * StrobeGuard mark: a shield with a lightning bolt split across a filter line, amber (the
 * original flash) above and teal (the filtered result) below. Same geometry as
 * public/brand/strobeguard-mark.svg; at small sizes it uses the favicon's heavier strokes so it
 * stays legible.
 */
export function Mark({ size = 22 }: { size?: number }) {
  // Unique clip-path id per instance: the mark appears several times on one page.
  const clipId = `sg-mark-${useId().replace(/:/g, '')}`;
  const small = size <= 24;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="mark">
      <defs>
        <clipPath id={clipId}><path d="M0 0 H64 V23.4 L0 42.6 Z" /></clipPath>
      </defs>
      <path
        d="M32 3.5 L55 11 V29 C55 44.5 45.5 54.5 32 60.5 C18.5 54.5 9 44.5 9 29 V11 Z"
        fill="#11252A" stroke="#65BDAC" strokeWidth={small ? 7 : 4.5} strokeLinejoin="round"
      />
      <g transform={small ? 'translate(8.32 9.32) scale(0.74)' : 'translate(10.88 11.88) scale(0.66)'}>
        <path d="M37 5 L13 37 H29.5 L25 59 L51 25 H34.5 Z" fill="#65BDAC" />
        <path clipPath={`url(#${clipId})`} d="M37 5 L13 37 H29.5 L25 59 L51 25 H34.5 Z" fill="#C4914F" />
        <path d="M6 40.8 L58 25.2" stroke="#11252A" strokeWidth={small ? 10 : 8} />
      </g>
    </svg>
  );
}
