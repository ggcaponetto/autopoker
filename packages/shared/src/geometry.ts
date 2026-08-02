import { z } from 'zod';

export const PointSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
});
export type Point = z.infer<typeof PointSchema>;

export const RectSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type Rect = z.infer<typeof RectSchema>;

export const RgbSchema = z.object({
  r: z.number().int().min(0).max(255),
  g: z.number().int().min(0).max(255),
  b: z.number().int().min(0).max(255),
});
export type Rgb = z.infer<typeof RgbSchema>;

export function rectCenter(rect: Rect): Point {
  return {
    x: rect.x + Math.floor(rect.width / 2),
    y: rect.y + Math.floor(rect.height / 2),
  };
}

export function isPointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x < rect.x + rect.width &&
    point.y >= rect.y &&
    point.y < rect.y + rect.height
  );
}

/** Clamp a rect to the bounds of a frame of the given size. Returns null if nothing overlaps. */
export function clampRectToBounds(rect: Rect, width: number, height: number): Rect | null {
  const x = Math.max(0, rect.x);
  const y = Math.max(0, rect.y);
  const right = Math.min(width, rect.x + rect.width);
  const bottom = Math.min(height, rect.y + rect.height);
  if (right - x <= 0 || bottom - y <= 0) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/** Chebyshev distance between two colors: the largest per-channel difference. */
export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
}
