// tests/integration/pullPush.spec.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTempRepoSet, writeFile, readFile, commit, push, type TempRepoSet } from './helpers/tempRepo';
import { RealGitRunner } from '../../src/git/RealGitRunner';
import { executeJob } from '../../src/sync/jobImpls';
import { ConflictGuard } from '../../src/sync/ConflictGuard';
import { SyncState } from '../../src/state/SyncState';
import { DEFAULT_SETTINGS } from '../../src/settings/settings';
import { makeJob } from '../../src/sync/jobs';
import { ErrorKind } from '../../src/sync/errorClassifier';

describe('integration: pull/push happy path', () => {
  let set: TempRepoSet;
  beforeEach(async () => { set = await makeTempRepoSet(); });
  afterEach(async () => { await set.cleanup(); });

  it('clientB pulls clientA changes and pushes its own', async () => {
    // clientA writes & pushes
    await writeFile(set.clientA, 'notes/a.md', 'hello\n');
    await commit(set.clientA, 'add a');
    await push(set.clientA);

    // clientB syncs
    const guard = new ConflictGuard();
    const state = new SyncState();
    const git = new RealGitRunner({ cwd: set.clientB });
    const out = await executeJob({
      git, settings: DEFAULT_SETTINGS, guard, state, vaultPath: set.clientB, pauseAutoTriggers: () => {},
    }, makeJob('full', 'manual'));

    expect(out.errorKind).toBe(ErrorKind.Ok);
    const got = await readFile(set.clientB, 'notes/a.md');
    expect(got).toBe('hello\n');
  });
});
