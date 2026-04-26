// tests/integration/autoStashRebase.spec.ts
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

describe('integration: autostash (rebase mode)', () => {
  let set: TempRepoSet;
  beforeEach(async () => { set = await makeTempRepoSet(); });
  afterEach(async () => { await set.cleanup(); });

  it('handles dirty working tree on pull', async () => {
    await writeFile(set.clientA, 'a.md', 'A\n');
    await commit(set.clientA, 'A1');
    await push(set.clientA);

    // B has uncommitted edits in a different file
    await fs.writeFile(path.join(set.clientB, 'unstaged.md'), 'wip\n');

    const guard = new ConflictGuard();
    const state = new SyncState();
    const git = new RealGitRunner({ cwd: set.clientB });
    const out = await executeJob({
      git, settings: DEFAULT_SETTINGS, guard, state, vaultPath: set.clientB, pauseAutoTriggers: () => {},
    }, makeJob('full', 'manual'));

    expect(out.errorKind).toBe(ErrorKind.Ok);
    // The unstaged file should be committed and pushed
    expect(await fs.readFile(path.join(set.clientB, 'unstaged.md'), 'utf8')).toBe('wip\n');
  });
});
