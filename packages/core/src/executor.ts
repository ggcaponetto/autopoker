import type { ClickTarget, Point } from '@autopoker/shared';
import type { ActionExecutor, ActionRequest, InputController } from './types';

export interface StepExecutorOptions {
  /** Checked before every step; returning false aborts the remaining steps. */
  guard?: () => boolean;
  /** Injectable for tests; defaults to real setTimeout sleep. */
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function resolveTarget(target: ClickTarget, regionCenter: Point): Point {
  return target === 'regionCenter' ? regionCenter : target;
}

/** Executes a request's steps against an InputController, one step at a time. */
export class StepActionExecutor implements ActionExecutor {
  constructor(
    private readonly input: InputController,
    private readonly options: StepExecutorOptions = {},
  ) {}

  async execute(request: ActionRequest): Promise<void> {
    const sleep = this.options.sleep ?? realSleep;
    for (const step of request.steps) {
      if (this.options.guard && !this.options.guard()) return;
      switch (step.type) {
        case 'moveMouse':
          this.input.moveMouse(resolveTarget(step.target, request.regionCenter));
          break;
        case 'click':
          this.input.moveMouse(resolveTarget(step.target, request.regionCenter));
          this.input.click(step.button, step.double);
          break;
        case 'typeText':
          this.input.typeText(step.text);
          break;
        case 'keyTap':
          this.input.keyTap(step.key, step.modifiers);
          break;
        case 'delay':
          await sleep(step.ms);
          break;
      }
    }
  }
}
