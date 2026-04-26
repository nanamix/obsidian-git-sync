// tests/integration/conflictRebase.spec.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTempRepoSet, writeFile, commit, push, type TempRepoSet } from './helpers/tempRepo';
import { RealGitRunner } from '../../src/git/RealGitRunner';
import { executeJob } from '../../src/sync/jobImpls';
import { ConflictGuard } from '../../src/sync/ConflictGuard';
import { SyncState } from '../../src/state/SyncState';
import { DEFAULT_SETTINGS } from '../../src/settings/settings';
import { makeJob } from '../../src/sync/jobs';
import { ErrorKind } from '../../src/sync/errorClassifier';

describe('integration: rebase conflict', () => {
  let set: TempRepoSet;
  beforeEach(async () => { set = await makeTempRepoSet(); });
  afterEach(async () => { await set.cleanup(); });

  it('detects conflict and locks ConflictGuard', async () => {
    // Both edit same line
    await writeFile(set.clientA, 'notes/x.md', 'A\n');
    await commit(set.clientA, 'A wrote');
    await push(set.clientA);

    await writeFile(set.clientB, 'notes/x.md', 'B\n');
    await commit(set.clientB, 'B wrote');
    // Don't push from B yet — the conflict should arise on pull.

    // Now A makes another change conflicting at the same line
    await writeFile(set.clientA, 'notes/x.md', 'A2\n');
    await commit(set.clientA, 'A re-wrote');
    await push(set.clientA);

    const guard = new ConflictGuard();
    const state = new SyncState();
    const git = new RealGitRunner({ cwd: set.clientB });
    const out = await executeJob({
      git, settings: DEFAULT_SETTINGS, guard, state, vaultPath: set.clientB, pauseAutoTriggers: () => {},
    }, makeJob('full', 'manual'));

    expect(out.errorKind).toBe(ErrorKind.Conflict);
    expect(guard.isLocked()).toBe(true);
    expect(guard.lockReason()).toBe('rebase');
  });
});
