import { describe, it, expect, vi } from 'vitest';
import { ConflictGuard } from '../../src/sync/ConflictGuard';

describe('ConflictGuard', () => {
  it('starts unlocked', () => {
    const g = new ConflictGuard();
    expect(g.isLocked()).toBe(false);
  });

  it('lock and unlock toggle state', () => {
    const g = new ConflictGuard();
    g.lock('rebase');
    expect(g.isLocked()).toBe(true);
    expect(g.lockReason()).toBe('rebase');
    g.unlock();
    expect(g.isLocked()).toBe(false);
    expect(g.lockReason()).toBeUndefined();
  });

  it('notifies subscribers on lock and unlock', () => {
    const g = new ConflictGuard();
    const cb = vi.fn();
    g.subscribe(cb);
    g.lock('merge');
    g.unlock();
    expect(cb).toHaveBeenNthCalledWith(1, true);
    expect(cb).toHaveBeenNthCalledWith(2, false);
  });

  it('unsubscribe stops notifications', () => {
    const g = new ConflictGuard();
    const cb = vi.fn();
    const off = g.subscribe(cb);
    off();
    g.lock('rebase');
    expect(cb).not.toHaveBeenCalled();
  });
});
