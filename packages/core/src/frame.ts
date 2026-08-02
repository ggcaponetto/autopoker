import { clampRectToBounds, type Point, type Rect, type Rgb } from '@autopoker/shared';
import type { Frame } from './types';

/** Copy a rect out of a frame, clamped to its bounds. Returns null if nothing overlaps. */
export function cropRgba(frame: Frame, rect: Rect): Frame | null {
  const clamped = clampRectToBounds(rect, frame.width, frame.height);
  if (!clamped) return null;
  const out = new Uint8Array(clamped.width * clamped.height * 4);
  const rowBytes = clamped.width * 4;
  for (let row = 0; row < clamped.height; row++) {
    const srcStart = ((clamped.y + row) * frame.width + clamped.x) * 4;
    out.set(frame.rgba.subarray(srcStart, srcStart + rowBytes), row * rowBytes);
  }
  return { width: clamped.width, height: clamped.height, rgba: out };
}

export function colorAt(frame: Frame, point: Point): Rgb | null {
  if (point.x < 0 || point.y < 0 || point.x >= frame.width || point.y >= frame.height) return null;
  const i = (point.y * frame.width + point.x) * 4;
  return { r: frame.rgba[i]!, g: frame.rgba[i + 1]!, b: frame.rgba[i + 2]! };
}

export function averageColor(frame: Frame): Rgb {
  const pixels = frame.width * frame.height;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < pixels * 4; i += 4) {
    r += frame.rgba[i]!;
    g += frame.rgba[i + 1]!;
    b += frame.rgba[i + 2]!;
  }
  return { r: Math.round(r / pixels), g: Math.round(g / pixels), b: Math.round(b / pixels) };
}
