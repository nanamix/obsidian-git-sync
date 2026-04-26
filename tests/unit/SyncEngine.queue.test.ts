import { describe, it, expect, vi } from 'vitest';
import { SyncEngine } from '../../src/sync/SyncEngine';
import { ConflictGuard } from '../../src/sync/ConflictGuard';
import { makeJob, type Job } from '../../src/sync/jobs';

describe('SyncEngine queue', () => {
  it('runs jobs serially in order', async () => {
    const guard = new ConflictGuard();
    const order: string[] = [];
    const engine = new SyncEngine({
      guard,
      execute: async (job: Job) => {
        order.push(job.coalesceKey);
        await new Promise((r) => setTimeout(r, 1));
      },
    });
    engine.enqueue(makeJob('full', 'manual'));
    engine.enqueue(makeJob('pull', 'manual'));
    await engine.drain();
    expect(order).toEqual(['full:manual:true', 'pull:manual:true']);
  });

  it('coalesces identical jobs at the tail of the queue', async () => {
    const guard = new ConflictGuard();
    const fn = vi.fn(async () => {});
    const engine = new SyncEngine({ guard, execute: fn });
    // First runs immediately; the next two should coalesce while first is in-flight.
    engine.enqueue(makeJob('full', 'interval'));
    engine.enqueue(makeJob('full', 'interval'));
    engine.enqueue(makeJob('full', 'interval'));
    await engine.drain();
    expect(fn).toHaveBeenCalledTimes(2); // first executing + one queued+coalesced
  });

  it('drops automatic jobs when conflict guard is locked', async () => {
    const guard = new ConflictGuard();
    guard.lock('rebase');
    const fn = vi.fn(async () => {});
    const onSkipped = vi.fn();
    const engine = new SyncEngine({ guard, execute: fn, onSkipped });
    engine.enqueue(makeJob('full', 'interval'));
    await engine.drain();
    expect(fn).not.toHaveBeenCalled();
    expect(onSkipped).toHaveBeenCalled();
  });

  it('still runs manual jobs when conflict guard is locked', async () => {
    const guard = new ConflictGuard();
    guard.lock('rebase');
    const fn = vi.fn(async () => {});
    const engine = new SyncEngine({ guard, execute: fn });
    engine.enqueue(makeJob('full', 'manual'));
    await engine.drain();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
