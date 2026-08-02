import type { LlmDecision } from '@autopoker/shared';
import type { DecisionRequest, DecisionResult, DecisionSource } from './types';

/**
 * Returns scripted decisions instead of calling a model. Lets the whole capture →
 * decide → act loop be exercised (and demoed) with no model installed and no API key.
 *
 * The default script clicks the first landmark, which makes it useful as a live
 * end-to-end check of coordinate mapping and action execution.
 */
export class MockDecisionSource implements DecisionSource {
  private call = 0;

  constructor(
    private readonly script?: (request: DecisionRequest, call: number) => LlmDecision,
    private readonly latencyMs = 5,
  ) {}

  async decide(request: DecisionRequest): Promise<DecisionResult> {
    const call = this.call++;
    const decision = this.script?.(request, call) ?? defaultDecision(request);
    return { decision, latencyMs: this.latencyMs, model: 'mock', usage: undefined };
  }
}

function defaultDecision(request: DecisionRequest): LlmDecision {
  const landmark = request.landmarks[0];
  const seen = `mock: ${request.screenshots.length} screenshot(s), ${request.landmarks.length} landmark(s)`;
  if (!landmark) {
    return {
      observation: seen,
      reasoning: 'No landmarks are registered, so there is nothing safe to click.',
      confidence: 1,
      actions: [{ type: 'wait' }],
    };
  }
  return {
    observation: seen,
    reasoning: `Mock provider always clicks the first landmark ("${landmark.name}").`,
    confidence: 1,
    actions: [{ type: 'clickRegion', regionName: landmark.name }],
  };
}
