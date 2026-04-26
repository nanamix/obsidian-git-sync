import type { ConflictGuard } from './ConflictGuard';
import type { Job } from './jobs';

export interface SyncEngineOpts {
  guard: ConflictGuard;
  execute: (job: Job) => Promise<void>;
  onSkipped?: (job: Job, reason: string) => void;
}

export class SyncEngine {
  private queue: Job[] = [];
  private working = false;
  private idleResolver: (() => void) | undefined;

  constructor(private readonly opts: SyncEngineOpts) {}

  enqueue(job: Job): void {
    if (!job.bypassConflictGuard && this.opts.guard.isLocked()) {
      this.opts.onSkipped?.(job, 'conflict guard locked');
      return;
    }
    const tail = this.queue[this.queue.length - 1];
    if (tail && tail.coalesceKey === job.coalesceKey) {
      // Coalesce: drop duplicate
      return;
    }
    this.queue.push(job);
    void this.runWorker();
  }

  private async runWorker(): Promise<void> {
    if (this.working) return;
    this.working = true;
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift()!;
        // Re-check guard at execution time — state may have changed while waiting.
        if (!job.bypassConflictGuard && this.opts.guard.isLocked()) {
          this.opts.onSkipped?.(job, 'conflict guard locked at exec');
          continue;
        }
        await this.opts.execute(job);
      }
    } finally {
      this.working = false;
      if (this.idleResolver) {
        const r = this.idleResolver;
        this.idleResolver = undefined;
        r();
      }
    }
  }

  /** Resolves once the queue is empty and worker has exited. */
  drain(): Promise<void> {
    if (!this.working && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.idleResolver = resolve;
    });
  }

  isBusy(): boolean { return this.working; }
  pendingCount(): number { return this.queue.length; }
}
