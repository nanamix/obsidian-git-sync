import os from 'node:os';
import type { GitRunner, GitResult } from '../git/GitRunner';
import type { PluginSettings, TriggerKind } from '../settings/settings';
import { ErrorKind, classifyError } from './errorClassifier';
import { runPreFlight, PreFlightOutcome } from './preFlight';
import { ConflictGuard } from './ConflictGuard';
import { SyncState } from '../state/SyncState';
import {
  buildCommitBody,
  buildCommitMessage,
  parseStatusPorcelain,
  type ChangeStats,
} from '../commit/CommitMessageBuilder';
import type { Job } from './jobs';

export interface JobDeps {
  git: GitRunner;
  settings: PluginSettings;
  guard: ConflictGuard;
  state: SyncState;
  vaultPath: string;
  /** Pause auto-triggers until next plugin load (for AuthError). */
  pauseAutoTriggers: () => void;
}

export interface JobOutcome {
  errorKind: ErrorKind;
  message: string;
}

export async function executeJob(deps: JobDeps, job: Job): Promise<JobOutcome> {
  switch (job.kind) {
    case 'full':            return await runFullSync(deps, job.trigger);
    case 'pull':            return await runPull(deps, job.trigger);
    case 'commit':          return await runCommitOnly(deps, job.trigger);
    case 'push':            return await runPushOnly(deps, job.trigger);
    case 'resolveConflicts':return await runResolveConflicts(deps, job.trigger);
  }
}

async function runFullSync(deps: JobDeps, trigger: TriggerKind): Promise<JobOutcome> {
  const pre = await preFlightOrFail(deps);
  if (pre) return pre;

  deps.state.setPhase('pulling');
  const pullOutcome = await pullStage(deps);
  if (pullOutcome.errorKind !== ErrorKind.Ok) return finalize(deps, trigger, pullOutcome);

  // Commit if dirty
  deps.state.setPhase('committing');
  const committed = await commitIfDirty(deps, trigger);
  if (committed.errorKind !== ErrorKind.Ok) return finalize(deps, trigger, committed);

  // Push (with one-shot retry on non-fast-forward)
  deps.state.setPhase('pushing');
  const pushed = await pushWithRetry(deps);
  return finalize(deps, trigger, pushed);
}

async function runPull(deps: JobDeps, trigger: TriggerKind): Promise<JobOutcome> {
  const pre = await preFlightOrFail(deps);
  if (pre) return pre;
  deps.state.setPhase('pulling');
  return finalize(deps, trigger, await pullStage(deps));
}

async function runCommitOnly(deps: JobDeps, trigger: TriggerKind): Promise<JobOutcome> {
  const pre = await preFlightOrFail(deps);
  if (pre) return pre;
  deps.state.setPhase('committing');
  return finalize(deps, trigger, await commitIfDirty(deps, trigger));
}

async function runPushOnly(deps: JobDeps, trigger: TriggerKind): Promise<JobOutcome> {
  const pre = await preFlightOrFail(deps);
  if (pre) return pre;
  deps.state.setPhase('pushing');
  return finalize(deps, trigger, await pushWithRetry(deps));
}

async function runResolveConflicts(deps: JobDeps, trigger: TriggerKind): Promise<JobOutcome> {
  // 1. Verify no conflict markers remain in file content (checked before staging)
  const markerCheck = await deps.git.run(['grep', '-l', '^<<<<<<<', '--', '.']);
  if (markerCheck.exitCode === 0 && markerCheck.stdout.trim().length > 0) {
    return finalize(deps, trigger, {
      errorKind: ErrorKind.Conflict,
      message: 'Unresolved conflict markers still present. Remove all `<<<<<<<` markers first.',
    });
  }
  // 2. Stage everything
  const add = await deps.git.run(['add', '-A']);
  if (add.exitCode !== 0) return finalize(deps, trigger, { errorKind: ErrorKind.UnknownError, message: add.stderr });
  // 3. Continue rebase or commit merge
  const reason = deps.guard.lockReason();
  if (reason === 'rebase') {
    const cont = await deps.git.run(['rebase', '--continue']);
    if (cont.exitCode !== 0) {
      return finalize(deps, trigger, { errorKind: classifyError(cont), message: cont.stderr || cont.stdout });
    }
  } else {
    // merge mode: if there's a MERGE_HEAD, commit it; else just commit normally.
    const cont = await deps.git.run(['commit', '--no-edit']);
    if (cont.exitCode !== 0) {
      return finalize(deps, trigger, { errorKind: classifyError(cont), message: cont.stderr || cont.stdout });
    }
  }
  deps.guard.unlock();
  return finalize(deps, trigger, { errorKind: ErrorKind.Ok, message: 'conflicts resolved' });
}

// ----- Stages -----

async function preFlightOrFail(deps: JobDeps): Promise<JobOutcome | null> {
  const pf = await runPreFlight(deps.git, deps.settings, deps.vaultPath);
  if (pf.outcome === PreFlightOutcome.Ok) return null;
  if (pf.outcome === PreFlightOutcome.MergeMarkersPresent) {
    deps.guard.lock(deps.settings.conflict.pullStrategy);
  }
  return {
    errorKind: pf.outcome === PreFlightOutcome.MergeMarkersPresent ? ErrorKind.Conflict : ErrorKind.UnknownError,
    message: `pre-flight: ${pf.outcome}${pf.detail ? ` (${pf.detail})` : ''}`,
  };
}

async function pullStage(deps: JobDeps): Promise<JobOutcome> {
  const { remote, branch } = deps.settings.repo;
  const strategy = deps.settings.conflict.pullStrategy;

  if (strategy === 'rebase') {
    const r = await deps.git.run(['pull', '--rebase', '--autostash', remote, branch]);
    return mapPullResult(deps, r, 'rebase');
  } else {
    // Explicit stash wrap — `--no-rebase` does not autostash.
    const dirty = await isDirty(deps);
    let stashed = false;
    if (dirty) {
      const stash = await deps.git.run(['stash', 'push', '-u', '-m', `obsidian-sync auto-stash ${Date.now()}`]);
      if (stash.exitCode !== 0) {
        return { errorKind: classifyError(stash), message: stash.stderr || stash.stdout };
      }
      stashed = true;
    }
    const r = await deps.git.run(['pull', '--no-rebase', remote, branch]);
    if (r.exitCode !== 0) {
      const kind = classifyError(r);
      if (kind === ErrorKind.Conflict) deps.guard.lock('merge');
      return { errorKind: kind, message: r.stderr || r.stdout };
    }
    if (stashed) {
      const pop = await deps.git.run(['stash', 'pop']);
      if (pop.exitCode !== 0) {
        const kind = classifyError(pop);
        if (kind === ErrorKind.Conflict) deps.guard.lock('merge');
        return { errorKind: kind, message: `stash pop failed: ${pop.stderr || pop.stdout}` };
      }
    }
    return { errorKind: ErrorKind.Ok, message: '' };
  }
}

function mapPullResult(deps: JobDeps, r: GitResult, mode: 'rebase' | 'merge'): JobOutcome {
  if (r.exitCode === 0) return { errorKind: ErrorKind.Ok, message: '' };
  const kind = classifyError(r);
  if (kind === ErrorKind.Conflict) deps.guard.lock(mode);
  if (kind === ErrorKind.AuthError) deps.pauseAutoTriggers();
  return { errorKind: kind, message: r.stderr || r.stdout };
}

async function isDirty(deps: JobDeps): Promise<boolean> {
  const s = await deps.git.run(['status', '--porcelain']);
  return s.stdout.trim().length > 0;
}

async function commitIfDirty(deps: JobDeps, trigger: TriggerKind): Promise<JobOutcome> {
  const status = await deps.git.run(['status', '--porcelain']);
  if (status.exitCode !== 0) return { errorKind: classifyError(status), message: status.stderr };
  if (status.stdout.trim().length === 0) return { errorKind: ErrorKind.Ok, message: 'no changes' };

  const add = await deps.git.run(['add', '-A']);
  if (add.exitCode !== 0) return { errorKind: classifyError(add), message: add.stderr };

  const stats: ChangeStats = parseStatusPorcelain(status.stdout);
  const branch = (await deps.git.run(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim() || deps.settings.repo.branch;
  const ctx = {
    hostname: os.hostname(),
    now: new Date(),
    trigger,
    branch,
    stats,
  };
  const message = buildCommitMessage(deps.settings.commit.template, ctx);
  const args = ['commit', '-m', message];
  if (deps.settings.commit.includeFileListInBody) {
    const body = buildCommitBody(ctx);
    if (body) args.push('-m', body);
  }
  const commit = await deps.git.run(args);
  if (commit.exitCode !== 0) return { errorKind: classifyError(commit), message: commit.stderr || commit.stdout };
  return { errorKind: ErrorKind.Ok, message: '' };
}

async function pushWithRetry(deps: JobDeps): Promise<JobOutcome> {
  const { remote, branch } = deps.settings.repo;
  const first = await deps.git.run(['push', remote, branch]);
  if (first.exitCode === 0) return { errorKind: ErrorKind.Ok, message: '' };
  const kind = classifyError(first);
  if (kind !== ErrorKind.PushRejected) {
    if (kind === ErrorKind.AuthError) deps.pauseAutoTriggers();
    return { errorKind: kind, message: first.stderr || first.stdout };
  }
  // One-shot recovery: re-pull and try once more.
  deps.state.setPhase('pulling');
  const repull = await pullStage(deps);
  if (repull.errorKind !== ErrorKind.Ok) return repull;
  deps.state.setPhase('pushing');
  const second = await deps.git.run(['push', remote, branch]);
  if (second.exitCode === 0) return { errorKind: ErrorKind.Ok, message: '' };
  return { errorKind: classifyError(second), message: second.stderr || second.stdout };
}

function finalize(deps: JobDeps, trigger: TriggerKind, outcome: JobOutcome): JobOutcome {
  if (outcome.errorKind === ErrorKind.Ok) {
    deps.state.recordSuccess(trigger);
  } else {
    deps.state.recordError(trigger, outcome.errorKind, outcome.message);
  }
  return outcome;
}
