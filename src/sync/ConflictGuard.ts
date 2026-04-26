import type { PullStrategy } from '../settings/settings';

export class ConflictGuard {
  private locked = false;
  private reason: PullStrategy | undefined;
  private subscribers = new Set<(locked: boolean) => void>();

  isLocked(): boolean { return this.locked; }
  lockReason(): PullStrategy | undefined { return this.reason; }

  lock(reason: PullStrategy): void {
    this.locked = true;
    this.reason = reason;
    this.notify();
  }

  unlock(): void {
    this.locked = false;
    this.reason = undefined;
    this.notify();
  }

  subscribe(cb: (locked: boolean) => void): () => void {
    this.subscribers.add(cb);
    return () => { this.subscribers.delete(cb); };
  }

  private notify(): void {
    for (const cb of this.subscribers) cb(this.locked);
  }
}
