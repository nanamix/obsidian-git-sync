// tests/integration/autoStashMerge.spec.ts
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

describe('integration: autostash (merge mode)', () => {
  let set: TempRepoSet;
  beforeEach(async () => { set = await makeTempRepoSet(); });
  afterEach(async () => { await set.cleanup(); });

  it('explicit stash wrap handles dirty tree under merge strategy', async () => {
    await writeFile(set.clientA, 'a.md', 'A\n');
    await commit(set.clientA, 'A1');
    await push(set.clientA);

    await fs.writeFile(path.join(set.clientB, 'unstaged.md'), 'wip\n');

    const settings = {
      ...DEFAULT_SETTINGS,
      conflict: { ...DEFAULT_SETTINGS.conflict, pullStrategy: 'merge' as const },
    };
    const guard = new ConflictGuard();
    const state = new SyncState();
    const git = new RealGitRunner({ cwd: set.clientB });
    const out = await executeJob({
      git, settings, guard, state, vaultPath: set.clientB, pauseAutoTriggers: () => {},
    }, makeJob('full', 'manual'));

    expect(out.errorKind).toBe(ErrorKind.Ok);
    expect(await fs.readFile(path.join(set.clientB, 'unstaged.md'), 'utf8')).toBe('wip\n');
  });
});
