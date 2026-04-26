// tests/integration/conflictResolution.spec.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { makeTempRepoSet, writeFile, commit, push, type TempRepoSet } from './helpers/tempRepo';
import { RealGitRunner } from '../../src/git/RealGitRunner';
import { executeJob } from '../../src/sync/jobImpls';
import { ConflictGuard } from '../../src/sync/ConflictGuard';
import { SyncState } from '../../src/state/SyncState';
import { DEFAULT_SETTINGS } from '../../src/settings/settings';
import { makeJob } from '../../src/sync/jobs';
import { ErrorKind } from '../../src/sync/errorClassifier';

describe('integration: conflict resolution roundtrip', () => {
  let set: TempRepoSet;
  beforeEach(async () => { set = await makeTempRepoSet(); });
  afterEach(async () => { await set.cleanup(); });

  it('user fixes markers and resolveConflicts job recovers', async () => {
    await writeFile(set.clientA, 'x.md', 'AAA\n');
    await commit(set.clientA, 'A1');
    await push(set.clientA);

    await writeFile(set.clientB, 'x.md', 'BBB\n');
    await commit(set.clientB, 'B1');

    await writeFile(set.clientA, 'x.md', 'AAA2\n');
    await commit(set.clientA, 'A2');
    await push(set.clientA);

    const guard = new ConflictGuard();
    const state = new SyncState();
    const git = new RealGitRunner({ cwd: set.clientB });
    const deps = { git, settings: DEFAULT_SETTINGS, guard, state, vaultPath: set.clientB, pauseAutoTriggers: () => {} };

    const fail = await executeJob(deps, makeJob('full', 'manual'));
    expect(fail.errorKind).toBe(ErrorKind.Conflict);
    expect(guard.isLocked()).toBe(true);

    // User fixes markers
    await fs.writeFile(path.join(set.clientB, 'x.md'), 'RESOLVED\n');

    const ok = await executeJob(deps, makeJob('resolveConflicts', 'manual'));
    expect(ok.errorKind).toBe(ErrorKind.Ok);
    expect(guard.isLocked()).toBe(false);
  });
});
