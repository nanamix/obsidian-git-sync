import type { TriggerKind } from '../settings/settings';

export type JobKind = 'full' | 'pull' | 'commit' | 'push' | 'resolveConflicts';

export interface Job {
  kind: JobKind;
  trigger: TriggerKind;
  /** Only `manual` and `resolveConflicts` jobs bypass the ConflictGuard at enqueue time. */
  bypassConflictGuard: boolean;
  /** A coalescing key. Identical keys at the queue tail get deduped. */
  coalesceKey: string;
}

export function makeJob(kind: JobKind, trigger: TriggerKind): Job {
  const bypass = trigger === 'manual' || kind === 'resolveConflicts';
  return {
    kind,
    trigger,
    bypassConflictGuard: bypass,
    coalesceKey: `${kind}:${trigger}:${bypass}`,
  };
}
