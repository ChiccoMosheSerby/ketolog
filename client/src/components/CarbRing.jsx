import { zoneInfo } from '../lib/helpers.js';
import './CarbRing.scss';

// Circular net-carb gauge. The arc fills consumed/target (capped at full), and
// is colored by the same zone logic as the bars (green under target → red over).
// `children` render centered inside the ring.
export default function CarbRing({ consumed, target, size = 160, stroke = 15, children }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const frac = target > 0 ? Math.max(0, Math.min(consumed / target, 1)) : 0;
  const offset = circ * (1 - frac);
  const color = zoneInfo(consumed, target).color;
  const c = size / 2;

  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--tint)" strokeWidth={stroke} />
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${c} ${c})`}
          style={{ transition: 'stroke-dashoffset .45s ease, stroke .45s ease' }}
        />
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}
