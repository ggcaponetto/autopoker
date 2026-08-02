import { rectCenter } from '@autopoker/shared';
import type { ActionRequest, CoordinateMapper, Decider, RegionEvaluation } from './types';

/** MVP decider: every region that triggered this tick becomes one action request. */
export class RegionRuleDecider implements Decider {
  constructor(private readonly mapper: CoordinateMapper) {}

  decide(input: { tick: number; evaluations: RegionEvaluation[] }): ActionRequest[] {
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
