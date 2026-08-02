import { rectCenter } from '@autopoker/shared';
import type { ActionRequest, CoordinateMapper, Decider, DeciderInput } from './types';

/** Rule-based decider: every region that triggered this tick becomes one action request. */
export class RegionRuleDecider implements Decider {
  constructor(private readonly mapper: CoordinateMapper) {}

  decide(input: DeciderInput): ActionRequest[] {
    return input.evaluations
      .filter((evaluation) => evaluation.triggered)
      .map(({ region }) => ({
        regionId: region.id,
        regionName: region.name,
        steps: region.actions,
        regionCenter: this.mapper.toScreen(region.monitorKey, rectCenter(region.rect)),
      }));
  }
}
