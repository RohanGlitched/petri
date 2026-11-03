// A petri dish seen from above with a glider growing in it.
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="14.5" fill="#e9c477" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="16" cy="16" r="11.8" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="0.8" />
      <g fill="#6b2fa0">
        <circle cx="16" cy="9.6" r="2.3" />
        <circle cx="21" cy="14.6" r="2.3" />
        <circle cx="11" cy="19.6" r="2.3" />
        <circle cx="16" cy="19.6" r="2.3" />
        <circle cx="21" cy="19.6" r="2.3" />
      </g>
    </svg>
  );
}
