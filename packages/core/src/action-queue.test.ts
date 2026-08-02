import { describe, expect, it } from 'vitest';
import { ActionQueue } from './action-queue';
import type { ActionExecutor, ActionRequest } from './types';

function request(id: string): ActionRequest {
  return {
    regionId: id,
    regionName: id,
    steps: [{ type: 'delay', ms: 0 }],
    regionCenter: { x: 0, y: 0 },
  };
}

function deferredExecutor() {
  const started: string[] = [];
  const finished: string[] = [];
  const resolvers: Array<() => void> = [];
  const executor: ActionExecutor = {
    execute(req) {
      started.push(req.regionId);
      return new Promise<void>((resolve) => {
        resolvers.push(() => {
          finished.push(req.regionId);
          resolve();
        });
      });
    },
  };
  return { executor, started, finished, resolveNext: () => resolvers.shift()?.() };
}

describe('ActionQueue', () => {
  it('runs requests serially in FIFO order', async () => {
    const { executor, started, finished, resolveNext } = deferredExecutor();
    const queue = new ActionQueue(executor, { depthCap: 3 });
    expect(queue.enqueue(request('a'))).toBe(true);
    expect(queue.enqueue(request('b'))).toBe(true);
    await Promise.resolve();
    expect(started).toEqual(['a']);
    resolveNext();
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual(['a', 'b']);
    resolveNext();
    await Promise.resolve();
    expect(finished).toEqual(['a', 'b']);
    expect(queue.busy).toBe(false);
  });

  it('drops requests beyond the depth cap', async () => {
    const { executor, resolveNext } = deferredExecutor();
    const queue = new ActionQueue(executor);
    expect(queue.enqueue(request('a'))).toBe(true);
    expect(queue.enqueue(request('b'))).toBe(false);
    expect(queue.busy).toBe(true);
    resolveNext();
    await Promise.resolve();
    expect(queue.enqueue(request('c'))).toBe(true);
  });

  it('clear() drops pending requests but not the running one', async () => {
    const { executor, started, resolveNext } = deferredExecutor();
    const queue = new ActionQueue(executor, { depthCap: 5 });
    queue.enqueue(request('a'));
    queue.enqueue(request('b'));
    queue.clear();
    resolveNext();
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual(['a']);
    expect(queue.busy).toBe(false);
  });

  it('reports executor errors and keeps going', async () => {
    const errors: string[] = [];
    const queue = new ActionQueue(
      {
        execute(req) {
          return req.regionId === 'boom' ? Promise.reject(new Error('nope')) : Promise.resolve();
        },
      },
      { depthCap: 5, onError: (req) => errors.push(req.regionId) },
    );
    queue.enqueue(request('boom'));
    queue.enqueue(request('ok'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errors).toEqual(['boom']);
    expect(queue.busy).toBe(false);
  });
});
