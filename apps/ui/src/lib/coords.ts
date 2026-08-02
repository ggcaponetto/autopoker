import type { Point, Rect } from '@autopoker/shared';

/**
 * Map a mouse position over the scaled preview <img> to capture-pixel coordinates.
 * The preview is rendered at an arbitrary CSS size; regions are stored in capture pixels.
 */
export function clientToCapture(
  clientX: number,
  clientY: number,
  bounds: { left: number; top: number; width: number; height: number },
  captureWidth: number,
  captureHeight: number,
): Point {
  const x = Math.round(((clientX - bounds.left) / bounds.width) * captureWidth);
  const y = Math.round(((clientY - bounds.top) / bounds.height) * captureHeight);
  return {
    x: Math.min(Math.max(x, 0), captureWidth - 1),
    y: Math.min(Math.max(y, 0), captureHeight - 1),
  };
}

/** Normalize two drag corners into a rect; null when smaller than minSize either way. */
export function rectFromDrag(a: Point, b: Point, minSize = 4): Rect | null {
  const width = Math.abs(a.x - b.x);
  const height = Math.abs(a.y - b.y);
  if (width < minSize || height < minSize) return null;
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width, height };
}

/** Position a capture-space rect over the preview using percentages (size-independent). */
export function rectToCss(rect: Rect, captureWidth: number, captureHeight: number) {
  return {
    left: `${(rect.x / captureWidth) * 100}%`,
    top: `${(rect.y / captureHeight) * 100}%`,
    width: `${(rect.width / captureWidth) * 100}%`,
    height: `${(rect.height / captureHeight) * 100}%`,
  };
}
