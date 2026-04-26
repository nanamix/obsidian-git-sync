// tests/integration/nonFastForward.spec.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTempRepoSet, writeFile, commit, push, type TempRepoSet } from './helpers/tempRepo';
import { RealGitRunner } from '../../src/git/RealGitRunner';
import { executeJob } from '../../src/sync/jobImpls';
import { ConflictGuard } from '../../src/sync/ConflictGuard';
import { SyncState } from '../../src/state/SyncState';
import { DEFAULT_SETTINGS } from '../../src/settings/settings';
import { makeJob } from '../../src/sync/jobs';
import { ErrorKind } from '../../src/sync/errorClassifier';

describe('integration: non-fast-forward push', () => {
  let set: TempRepoSet;
  beforeEach(async () => { set = await makeTempRepoSet(); });
  afterEach(async () => { await set.cleanup(); });

  it('retries via re-pull when push is rejected (non-conflicting changes)', async () => {
    // A pushes a non-conflicting change first
    await writeFile(set.clientA, 'a-only.md', 'A\n');
    await commit(set.clientA, 'A only');
    await push(set.clientA);

    // B has a different file changed locally
    await writeFile(set.clientB, 'b-only.md', 'B\n');
    await commit(set.clientB, 'B only');

    const guard = new ConflictGuard();
    const state = new SyncState();
    const git = new RealGitRunner({ cwd: set.clientB });
    const out = await executeJob({
      git, settings: DEFAULT_SETTINGS, guard, state, vaultPath: set.clientB, pauseAutoTriggers: () => {},
    }, makeJob('full', 'manual'));

    expect(out.errorKind).toBe(ErrorKind.Ok);
  });
});
