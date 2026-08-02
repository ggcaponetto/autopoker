import { describe, expect, it } from 'vitest';
import { StepActionExecutor } from './executor';
import { RecordingInput } from './testing';
import type { ActionRequest } from './types';

const center = { x: 100, y: 200 };

function request(steps: ActionRequest['steps']): ActionRequest {
  return { regionId: 'r1', regionName: 'Region', steps, regionCenter: center };
}

describe('StepActionExecutor', () => {
  it('clicks the region center by moving there first', async () => {
    const input = new RecordingInput();
    await new StepActionExecutor(input).execute(
      request([{ type: 'click', button: 'left', double: false, target: 'regionCenter' }]),
    );
    expect(input.recorded).toEqual([
      { kind: 'moveMouse', point: center },
      { kind: 'click', button: 'left', double: false },
    ]);
  });

  it('uses explicit point targets as-is', async () => {
    const input = new RecordingInput();
    await new StepActionExecutor(input).execute(
      request([{ type: 'moveMouse', target: { x: 5, y: 6 } }]),
    );
    expect(input.recorded).toEqual([{ kind: 'moveMouse', point: { x: 5, y: 6 } }]);
  });

  it('passes typeText and keyTap through and awaits delays', async () => {
    const input = new RecordingInput();
    const sleeps: number[] = [];
    await new StepActionExecutor(input, { sleep: async (ms) => void sleeps.push(ms) }).execute(
      request([
        { type: 'typeText', text: 'hello' },
        { type: 'delay', ms: 250 },
        { type: 'keyTap', key: 'enter', modifiers: ['control'] },
      ]),
    );
    expect(sleeps).toEqual([250]);
    expect(input.recorded).toEqual([
      { kind: 'typeText', text: 'hello' },
      { kind: 'keyTap', key: 'enter', modifiers: ['control'] },
    ]);
  });

  it('aborts remaining steps when the guard turns false', async () => {
    const input = new RecordingInput();
    let allowed = 1;
    await new StepActionExecutor(input, { guard: () => allowed-- > 0 }).execute(
      request([
        { type: 'typeText', text: 'first' },
        { type: 'typeText', text: 'second' },
      ]),
    );
    expect(input.recorded).toEqual([{ kind: 'typeText', text: 'first' }]);
  });
});
