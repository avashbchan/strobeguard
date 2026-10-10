/** StrobeGuard mark: a lens with its lower half shaded, like a neutral-density filter. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="mark">
      <defs>
        <clipPath id="sg-lower"><rect x="0" y="12" width="24" height="12" /></clipPath>
      </defs>
      <circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="9.25" fill="#24A190" clipPath="url(#sg-lower)" />
      <line x1="2.75" y1="12" x2="21.25" y2="12" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
