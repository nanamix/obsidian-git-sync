import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { GitRunner } from '../git/GitRunner';
import type { PluginSettings } from '../settings/settings';

export enum PreFlightOutcome {
  Ok = 'Ok',
  NotAGitRepo = 'NotAGitRepo',
  DetachedHead = 'DetachedHead',
  BranchMismatch = 'BranchMismatch',
  MergeMarkersPresent = 'MergeMarkersPresent',
  IndexLocked = 'IndexLocked',
}

export interface PreFlightResult {
  outcome: PreFlightOutcome;
  detail?: string;
}

export async function runPreFlight(
  git: GitRunner,
  settings: PluginSettings,
  vaultPath: string,
): Promise<PreFlightResult> {
  // 1. Work tree?
  const wt = await git.run(['rev-parse', '--is-inside-work-tree']);
  if (wt.exitCode !== 0 || wt.stdout.trim() !== 'true') {
    return { outcome: PreFlightOutcome.NotAGitRepo, detail: wt.stderr.trim() };
  }

  // 2. Detached HEAD?
  const head = await git.run(['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = head.stdout.trim();
  if (settings.safety.refuseIfDetachedHead && branch === 'HEAD') {
    return { outcome: PreFlightOutcome.DetachedHead };
  }

  // 3. Branch mismatch?
  if (settings.safety.refuseIfBranchMismatch && branch !== settings.repo.branch) {
    return { outcome: PreFlightOutcome.BranchMismatch, detail: `current=${branch}, configured=${settings.repo.branch}` };
  }

  // 4. Index lock?
  try {
    await fs.access(path.join(vaultPath, '.git', 'index.lock'));
    return { outcome: PreFlightOutcome.IndexLocked };
  } catch { /* no lock — good */ }

  // 5. Merge markers / unmerged paths via porcelain status.
  const status = await git.run(['status', '--porcelain', '-z']);
  if (status.exitCode === 0 && /(?:^| )(UU|AA|DD|U[ADM]|[ADM]U) /.test(status.stdout)) {
    return { outcome: PreFlightOutcome.MergeMarkersPresent };
  }

  return { outcome: PreFlightOutcome.Ok };
}
