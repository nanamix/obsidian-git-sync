import type { ErrorKind } from '../sync/errorClassifier';
import type { TriggerKind } from '../settings/settings';

export type SyncPhase = 'idle' | 'pulling' | 'committing' | 'pushing' | 'resolving' | 'error' | 'conflict';

export interface SyncStatus {
  phase: SyncPhase;
  lastResult?:
    | { kind: 'success'; at: number; trigger: TriggerKind }
    | { kind: 'error'; at: number; trigger: TriggerKind; errorKind: ErrorKind; message: string }
    | { kind: 'skipped'; at: number; trigger: TriggerKind; reason: string };
}

export class SyncState {
  private status: SyncStatus = { phase: 'idle' };
  private subscribers = new Set<(status: SyncStatus) => void>();

  get(): SyncStatus { return this.status; }

  setPhase(phase: SyncPhase): void {
    if (this.status.phase === phase) return;
    this.status = { ...this.status, phase };
    this.notify();
  }

  recordSuccess(trigger: TriggerKind): void {
    this.status = { phase: 'idle', lastResult: { kind: 'success', at: Date.now(), trigger } };
    this.notify();
  }

  recordError(trigger: TriggerKind, errorKind: ErrorKind, message: string): void {
    const phase: SyncPhase = errorKind === 'Conflict' ? 'conflict' : 'error';
    this.status = { phase, lastResult: { kind: 'error', at: Date.now(), trigger, errorKind, message } };
    this.notify();
  }

  recordSkipped(trigger: TriggerKind, reason: string): void {
    this.status = { ...this.status, lastResult: { kind: 'skipped', at: Date.now(), trigger, reason } };
    this.notify();
  }

  subscribe(cb: (status: SyncStatus) => void): () => void {
    this.subscribers.add(cb);
    cb(this.status);
    return () => { this.subscribers.delete(cb); };
  }

  private notify(): void {
    for (const cb of this.subscribers) cb(this.status);
  }
}
