import type { ActionExecutor, ActionQueueLike, ActionRequest } from './types';

export interface ActionQueueOptions {
  /** Maximum outstanding requests (running + pending). Defaults to 1 to prevent trigger storms. */
  depthCap?: number;
  onError?: (request: ActionRequest, error: unknown) => void;
}

/** Serial FIFO executor: one request's steps run to completion before the next starts. */
export class ActionQueue implements ActionQueueLike {
  private pending: ActionRequest[] = [];
  private running = false;

  constructor(
    private readonly executor: ActionExecutor,
    private readonly options: ActionQueueOptions = {},
  ) {}

  get busy(): boolean {
    return this.running || this.pending.length > 0;
  }

  /** Returns false when the queue is at capacity and the request was dropped. */
  enqueue(request: ActionRequest): boolean {
    const cap = this.options.depthCap ?? 1;
    if (this.pending.length + (this.running ? 1 : 0) >= cap) return false;
    this.pending.push(request);
    void this.drain();
    return true;
  }

  clear(): void {
    this.pending = [];
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      let request: ActionRequest | undefined;
      while ((request = this.pending.shift()) !== undefined) {
        try {
          await this.executor.execute(request);
        } catch (error) {
          this.options.onError?.(request, error);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
