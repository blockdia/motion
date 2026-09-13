import type { Point } from './index.js';

const smooth = (t: number) => {
  const p = Math.max(0, Math.min(1, t));
  return p * p * (3 - 2 * p);
};

/** Distance-weighted Bezier flight, sampled without playback history. */
export function curvedCursor(
  from: Point,
  to: Point,
  p: number,
  progress: number,
  dragging: boolean,
  duration: number,
) {
  const dx = to.x - from.x,
    dy = to.y - from.y,
    length = Math.hypot(dx, dy);
  if (length === 0) return { x: from.x + dx * p, y: from.y + dy * p, rotation: 0 };
  // Blend from an exact straight line, including longitudinal speed, so tiny
  // movements do not inherit the reference's asymmetric control handles.
  const pace = smooth(duration / 0.4);
  const curveStrength = smooth((length - 24) / 296) * pace * (dragging ? 0.45 : 1);
  const turnStrength = smooth((length - 48) / 352) * pace;
  const bend = Math.min(length * 0.62, 330) * 0.38 * curveStrength * (dx >= 0 ? -1 : 1);
  const departure = 1 / 3 + (0.38 - 1 / 3) * curveStrength;
  const arrival = 1 / 3 + (0.24 - 1 / 3) * curveStrength;
  const offset = { x: (-dy / length) * bend, y: (dx / length) * bend };
  const a = { x: from.x + dx * departure + offset.x, y: from.y + dy * departure + offset.y };
  const b = { x: to.x - dx * arrival + offset.x, y: to.y - dy * arrival + offset.y };
  const q = 1 - p;
  const tangent = Math.atan2(
    q * q * (a.y - from.y) + 2 * q * p * (b.y - a.y) + p * p * (to.y - b.y),
    q * q * (a.x - from.x) + 2 * q * p * (b.x - a.x) + p * p * (to.x - b.x),
  );
  const initial = Math.atan2(a.y - from.y, a.x - from.x);
  const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
  // The existing arrow points up-left. Unwrap relative to the departure tangent
  // so crossing +/-180 degrees cannot flip the cursor mid-flight.
  const rotation = ((wrap(initial + (3 * Math.PI) / 4) + wrap(tangent - initial)) * 180) / Math.PI;
  return {
    x: q ** 3 * from.x + 3 * q * q * p * a.x + 3 * q * p * p * b.x + p ** 3 * to.x,
    y: q ** 3 * from.y + 3 * q * q * p * a.y + 3 * q * p * p * b.y + p ** 3 * to.y,
    // A gentle lean rather than fully facing travel direction. Dragging has a
    // lower ceiling; the broad envelope avoids a rapid turn-and-reset gesture.
    rotation:
      (dragging ? 24 : 60) *
      Math.tanh(rotation / 60) *
      turnStrength *
      smooth(progress / 0.35) *
      smooth((1 - progress) / 0.4),
  };
}
