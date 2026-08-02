import { colorDistance, type Condition } from '@autopoker/shared';
import pixelmatch from 'pixelmatch';
import { averageColor, colorAt } from './frame';
import type { BaselineProvider, Frame } from './types';

export interface ConditionResult {
  matched: boolean;
  /** Color distance (0-255) or baseline diff percentage (0-100), when measurable. */
  value?: number;
}

export function evaluateCondition(
  condition: Condition,
  regionFrame: Frame,
  baselines: BaselineProvider,
): ConditionResult {
  switch (condition.type) {
    case 'colorAtPoint': {
      const color = colorAt(regionFrame, condition.point);
      if (!color) return { matched: false };
      const value = colorDistance(color, condition.color);
      return { matched: value <= condition.tolerance, value };
    }
    case 'regionAverageColor': {
      const value = colorDistance(averageColor(regionFrame), condition.color);
      return { matched: value <= condition.tolerance, value };
    }
    case 'baselineMatch':
    case 'baselineChanged': {
      const baseline = baselines.get(condition.baselineId);
      if (
        !baseline ||
        baseline.width !== regionFrame.width ||
        baseline.height !== regionFrame.height
      ) {
        return { matched: false };
      }
      const mismatched = pixelmatch(
        baseline.rgba,
        regionFrame.rgba,
        undefined,
        regionFrame.width,
        regionFrame.height,
        { threshold: 0.1 },
      );
      const value = (mismatched / (regionFrame.width * regionFrame.height)) * 100;
      return condition.type === 'baselineMatch'
        ? { matched: value <= condition.maxDiffPercent, value }
        : { matched: value >= condition.minDiffPercent, value };
    }
  }
}
