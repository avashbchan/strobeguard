// StrobeGuard mark: a circle whose lower half is filled teal (a "damped" light).
export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.5 10.75h15a7.5 7.5 0 0 1-15 0Z" fill="var(--teal)" />
    </svg>
  );
}
