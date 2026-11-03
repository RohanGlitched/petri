// The Petri mark: a glider (the pattern that carries a colony across the dish) in a round plate.
export function Mark({ className, size = 24 }: { className?: string; size?: number }) {
  const cells = [
    [1, 0],
    [2, 1],
    [0, 2],
    [1, 2],
    [2, 2],
  ];
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <radialGradient id="pm-agar" cx="38%" cy="34%" r="70%">
          <stop offset="0" stopColor="#7a3f12" />
          <stop offset="1" stopColor="#2a1407" />
        </radialGradient>
        <radialGradient id="pm-cell" cx="35%" cy="30%" r="75%">
          <stop offset="0" stopColor="#ffe0a8" />
          <stop offset="0.45" stopColor="#f2b45a" />
          <stop offset="1" stopColor="#a8621c" />
        </radialGradient>
      </defs>
      <circle cx="12" cy="12" r="11.2" fill="url(#pm-agar)" stroke="rgba(243,233,218,0.55)" strokeWidth="1" />
      {cells.map(([x, y]) => (
        <circle key={`${x}${y}`} cx={7.4 + x * 4.6} cy={7.4 + y * 4.6} r="1.95" fill="url(#pm-cell)" />
      ))}
    </svg>
  );
}
