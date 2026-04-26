# Obsidian Git Sync — Design Spec

- **Date**: 2026-04-26
- **Author**: JinYoung Ha (jyha@medicnc.co.kr)
- **Status**: Draft, awaiting user review
- **Replaces**: `github-sync` plugin by Kevin Chin (v1.0.6) currently in use at `~/Dev/medi-jyha-note/.obsidian/plugins/github-sync/`

## 1. Problem & Goals

### Problem
The user runs an Obsidian vault (`medi-jyha-note`) synced to a GitHub repository (`jyha81.github.com:nanamix/medi-jyha-note`) using a third-party `github-sync` community plugin. Plugin updates have been failing frequently, eroding trust. The user prefers to own the sync layer to ensure stability and to extend it with the exact behaviors they want.

### Goals (in priority order, all required)
1. **Stability** — predictable behavior, minimal external dependencies, no surprise breakage from upstream library updates.
2. **Real Git semantics** — leverage the system `git` CLI directly so that commit history, branches, merges, rebases, and conflict resolution all behave like a normal git workflow.
3. **Multi-device safety** — robust handling of edits made on multiple machines (currently `iMacmini`, MacBook).
4. **Configurable automation** — start/quit, periodic interval, post-edit debounce, and manual triggers — each independently toggleable.
5. **Mobile is out of scope** — desktop-only plugin (`isDesktopOnly: true`).

### Non-goals
- Mobile (iOS/Android) sync.
- Building a custom merge UI inside Obsidian — leverage Obsidian's native search/edit on standard `<<<<<<<` conflict markers instead.
- Managing GitHub auth/tokens — the plugin relies entirely on the user's existing system git configuration (SSH keys, credential helper, GPG signing).
- Repository bootstrapping (init/clone/configure remote) from inside the plugin in v1 — assume the vault is already a working git repo.

## 2. Architecture Overview

### High-level approach
Thin orchestrator that shells out to the system `git` binary via `child_process.spawn`. A single in-memory job queue with one worker serializes all git invocations. A `ConflictGuard` flag halts automatic triggers while a conflict is unresolved.

```
ObsidianPlugin (entry: onload/onunload — DI only)
 ├─ SyncEngine          — single-worker job queue
 │   ├─ GitRunner       — spawn('git', args, {cwd: vaultPath}) wrapper
 │   ├─ ConflictGuard   — lock state + manual unlock
 │   ├─ CommitMessageBuilder — template + git status stats
 │   └─ SyncState       — observable enum for UI
 ├─ TriggerManager      — subscribes to events per settings, enqueues jobs
 ├─ UISurface           — status bar, ribbon, notice, command palette
 └─ SettingsTab         — Obsidian PluginSettingTab
```

### Job types
```
Job = PullJob | CommitJob | PushJob | FullSyncJob
```
`FullSyncJob` (= pull → commit if dirty → push) is the canonical path. The other three exist for diagnostics / manual partial operations via the command palette.

### Invariants
1. **Single worker**: never two concurrent git processes against the same repo.
2. **Conflict lock blocks automatic jobs**: while merge markers are present in the vault, all auto-triggers are dropped.
3. **Vault-scoped git invocations**: `GitRunner` always passes `cwd = vault.adapter.basePath`; never operates outside the vault.
4. **Single mutation pathway**: every git command that mutates working tree (`pull`, `merge`, `rebase`, `checkout`) flows through `SyncEngine → GitRunner` only.

### Job queue semantics
- `enqueue(job)` returns immediately; the worker drains serially.
- **Coalescing**: if the tail of the queue already holds an identical `FullSyncJob`, drop the new one. Manual jobs always append.
- No interruption — running jobs always complete (or time out at quit).

## 3. Sync Algorithm — `FullSyncJob`

The canonical sequence executed for every automatic and manual full sync.

```
1. Pre-flight (any failure → abort with clear notice):
   a. git rev-parse --is-inside-work-tree
   b. settings.safety.refuseIfDetachedHead → check HEAD attached
   c. settings.safety.refuseIfBranchMismatch → current branch == settings.repo.branch
   d. No `<<<<<<<` markers present (git status -z scan)
   e. No .git/index.lock

2. Pull (handle any dirty state):
   - rebase strategy: git pull --rebase --autostash <remote> <branch>
   - merge  strategy: explicit wrap because --no-rebase has no autostash:
       if dirty:  git stash push -u -m "obsidian-sync auto-stash <ts>"
       then:      git pull --no-rebase <remote> <branch>
       if stashed: git stash pop  (pop conflict → ConflictError, stash retained in stash list)
   On exit code != 0:
     - stdout/stderr matches CONFLICT / "Merge conflict in":
         → ConflictGuard.lock(); notice; abort
     - matches network signatures:
         → NetworkError; abort (silent retry on next trigger)
     - matches auth signatures:
         → AuthError; pause auto-triggers until app restart; abort
     - else: UnknownError; abort

3. Commit (only if working tree dirty):
   git status --porcelain  → if empty, skip to step 4
   git add -A
   message = CommitMessageBuilder.build(settings.commit.template, stats, trigger)
   git commit -m "<message>"  (optionally -m "<file list body>")

4. Push:
   git push <remote> <branch>
   On rejected (non-fast-forward):
     - First failure: silently retry from step 2 (one-shot, race recovery).
     - Second failure: error notice; abort.

5. Post:
   SyncState.update({ last: 'success', at: now, trigger })
```

### Trigger → Job mapping

| Trigger                     | Job            | Notes |
|-----------------------------|----------------|-------|
| Workspace ready (startup)   | `FullSyncJob`  | Effectively a pull when local has no changes |
| App quit                    | `FullSyncJob`  | Bounded by `safety.quitTimeoutSeconds` (default 10s); abort if exceeded |
| Interval (e.g. every 5 min) | `FullSyncJob`  | Skipped if ConflictGuard locked |
| Vault-modify debounce       | `FullSyncJob`  | Fires after N seconds of no changes |
| Manual (hotkey/ribbon)      | `FullSyncJob`  | Bypasses ConflictGuard skip; pre-flight #d still rejects if markers present |
| "Pull only" command         | `PullJob`      | Diagnostic |
| "Commit only" command       | `CommitJob`    | Diagnostic |
| "Push only" command         | `PushJob`      | Diagnostic |

### App-quit handling
Obsidian's `onunload` does not await async work. Subscribe to the earliest available "about-to-quit" signal and run a time-bounded `FullSyncJob` (default 10s). On timeout, abort cleanly — vault integrity over completeness.

## 4. Settings

Persisted to plugin `data.json` via Obsidian's standard `loadData/saveData`.

```typescript
interface PluginSettings {
  repo: {
    branch: string;              // default 'main'
    remote: string;              // default 'origin'
  };
  triggers: {
    onWorkspaceReady: boolean;   // default true
    onAppQuit: boolean;          // default true
    interval:        { enabled: boolean; minutes: number };  // default false / 5
    onModifyDebounce:{ enabled: boolean; seconds: number };  // default false / 30
  };
  conflict: {
    pullStrategy: 'rebase' | 'merge';   // default 'rebase'
    onConflict:   'block' | 'isolate';  // default 'block' ('isolate' deferred to v2)
  };
  commit: {
    template: string;                   // default "{{hostname}} {{datetime}} ({{stats}})"
    includeFileListInBody: boolean;     // default false
  };
  safety: {
    quitTimeoutSeconds: number;         // default 10
    refuseIfDetachedHead: boolean;      // default true
    refuseIfBranchMismatch: boolean;    // default true
  };
  debug: {
    logToFile: boolean;                 // default false
    logFilePath: string;                // default '.obsidian/plugins/<id>/sync.log'
  };
}
```

### Commit message template variables
| Variable          | Value                                                  |
|-------------------|--------------------------------------------------------|
| `{{hostname}}`    | `os.hostname()`                                        |
| `{{date}}`        | ISO date (`2026-04-26`)                                |
| `{{datetime}}`    | ISO datetime with TZ (`2026-04-26T15:42:00+09:00`)     |
| `{{stats}}`       | summary like `3 modified, 1 added`                     |
| `{{filecount}}`   | total changed files                                    |
| `{{trigger}}`     | `manual` / `quit` / `interval` / `debounce` / `ready`  |
| `{{branch}}`      | current branch name                                    |

Default template: `"{{hostname}} {{datetime}} ({{stats}})"`

### Settings tab UI groups
1. **Repository** — branch, remote, status indicator (✓ git repo detected).
2. **Sync triggers** — four toggles (ready, quit, interval-with-minutes, debounce-with-seconds).
3. **Conflict handling** — pull strategy (rebase|merge), on-conflict (block|isolate).
4. **Commit message** — template input, available-variables list, file-list-in-body toggle, live preview.
5. **Safety** — quit timeout (s), refuse-if-detached, refuse-if-branch-mismatch.
6. **Debug** — log-to-file toggle, open-log button, clear-log button.

Settings changes apply immediately by re-subscribing `TriggerManager`.

## 5. UX Surfaces

1. **Status bar (single cell)** — `✓ Synced 2m ago` / `↻ Pulling…` / `↻ Pushing…` / `⚠ Conflict (N)` / `✗ Error`. Click → notice with last result detail.
2. **Ribbon icon** — left click = manual `Sync now`; long press / right click = command menu.
3. **Notice (transient)** — start, completion, and errors. Setting to suppress success notices for automatic triggers.
4. **Command palette** — `Sync now`, `Pull only`, `Commit only`, `Push only`, `Mark conflicts resolved`, `Show last error`, `Open log`.
5. **Conflict badge** — small red dot on the status bar cell while ConflictGuard is locked.

## 6. Error Handling

`GitRunner` returns `{ exitCode, stdout, stderr }`. `errorClassifier` maps that to one of:

| Kind             | Detection                                                                 | Auto-retry          | ConflictGuard | UX                                                                 |
|------------------|---------------------------------------------------------------------------|---------------------|---------------|--------------------------------------------------------------------|
| `ConflictError`  | exit ≠ 0 + `CONFLICT` / `Merge conflict in` in stdout                     | no                  | lock          | ⚠ persistent notice + "Mark conflicts resolved" instructions       |
| `PushRejected`   | exit ≠ 0 + `non-fast-forward` / `rejected` in stderr                      | yes, once (re-pull) | no            | First retry silent; second failure → error notice                   |
| `NetworkError`   | exit ≠ 0 + `Could not resolve host` / `Connection timed out` / `unable to access` | no                  | no            | ✗ status bar; next trigger naturally retries                        |
| `AuthError`      | exit ≠ 0 + `Permission denied` / `Authentication failed` / `publickey`    | no                  | no, but **pauses auto-triggers** | ✗ notice; auto-triggers resume on next Obsidian start               |
| `UnknownError`   | any other non-zero exit                                                   | no                  | no            | ✗ notice; "Show last error" command for full stdout/stderr          |

### Pre-flight refusals (vault integrity)
1. Vault root not a git work tree.
2. `safety.refuseIfDetachedHead` ON + HEAD detached.
3. `safety.refuseIfBranchMismatch` ON + current branch ≠ `settings.repo.branch`.
4. `<<<<<<<` markers present in any tracked file.
5. `.git/index.lock` exists.

### Conflict workflow
```
1. FullSyncJob → pull --rebase fails with CONFLICT
2. ConflictGuard.lock()
3. UI: red status bar "⚠ Conflict (N files)" + persistent notice instructing to
   search for "<<<<<<<" in vault and run "Mark conflicts resolved"
4. Auto-triggers ignored. Manual full-sync attempts also abort at pre-flight #4.
5. User edits in Obsidian, removes markers using the editor's search.
6. User runs command "Mark conflicts resolved":
   a. Plugin verifies no markers remain via git status; refuses if any remain.
   b. git add -A
   c. git rebase --continue (or git commit --no-edit if merge mode)
   d. ConflictGuard.unlock(); enqueue one FullSyncJob to push the resolution.
```

### Safety nets
1. `--autostash` keeps backups in `git stash list` if pop fails. Notice points the user there.
2. **First-run confirmation dialog** (one-time): on first auto-trigger after install, confirm "Enable automatic git operations on this vault? (branch: main, remote: origin)".
3. **Debug log file** (off by default): appends `args / cwd / exitCode / last 200 lines stdout&stderr` per invocation. No secrets.

## 7. Testing Strategy

### Unit tests (Vitest, ~70%)
Targets pure logic with `FakeGitRunner` substituted in.
- `CommitMessageBuilder.test.ts` — variable substitution coverage, empty stats, missing variable handling.
- `errorClassifier.test.ts` — sample stderr inputs → ErrorKind for all 5 kinds.
- `SyncEngine.queue.test.ts` — coalescing, serial execution, lock-state branching, idle worker invariants.
- `ConflictGuard.test.ts` — lock/unlock state transitions.
- `preFlight.test.ts` — each refusal condition fires exactly when expected.
- `triggerManager.test.ts` — settings toggle changes drive subscribe/unsubscribe correctly; interval cleanup.

### Integration tests (Vitest + real `git`, ~20%)
Each test creates a temp bare origin + two working clones in `os.tmpdir()` and tears down after.
- `pullPush.spec.ts` — A commits/pushes; B pulls and sees changes.
- `conflictRebase.spec.ts` — both edit same line; pull --rebase produces CONFLICT.
- `conflictResolution.spec.ts` — remove markers → "Mark conflicts resolved" → resumes cleanly.
- `nonFastForward.spec.ts` — B pushes after A; A's push rejected → one-shot retry succeeds.
- `autoStash.spec.ts` — dirty tree + pull --rebase --autostash applies cleanly.
- `branchMismatch.spec.ts` — checkout other branch → pre-flight refuses auto-trigger.

### Manual checklist (UI + real GitHub remote)
```
[ ] Fresh vault install → first-time confirm dialog gates auto-triggers
[ ] All settings toggles take effect on the next trigger
[ ] Interval 5 min → status bar updates after 5 min
[ ] Debounce 30s → idle 30s after edit triggers sync
[ ] Two devices same note → conflict markers → resolve → "Mark resolved" → recovery
[ ] WiFi off → NetworkError; back on → next trigger recovers
[ ] SSH disabled → AuthError → auto-triggers paused → resume on Obsidian restart
[ ] Quit timeout 10s with hundreds of file changes — abort path verified
[ ] Markers remaining at startup → pre-flight refusal + guidance
[ ] Every command-palette command works
```

### Coverage rationale
End-to-end against a real GitHub remote is intentionally excluded — git itself is trusted, and the GitHub call surface is captured by `NetworkError` classification. The unit + integration layers cover everything determined by the plugin code.

## 8. Project Layout & Build

### Directory tree
```
obsidian-git-sync/
├── manifest.json
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
├── .eslintrc.json
├── .prettierrc
├── README.md
├── docs/superpowers/specs/2026-04-26-obsidian-git-sync-design.md
├── src/
│   ├── main.ts
│   ├── settings/{settings.ts, settingsTab.ts}
│   ├── sync/{SyncEngine.ts, jobs.ts, ConflictGuard.ts, preFlight.ts, errorClassifier.ts}
│   ├── git/{GitRunner.ts, FakeGitRunner.ts}
│   ├── triggers/TriggerManager.ts
│   ├── ui/{statusBar.ts, ribbon.ts, notices.ts, commands.ts}
│   ├── commit/CommitMessageBuilder.ts
│   ├── state/SyncState.ts
│   └── lib/{debounce.ts, log.ts}
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── mocks/obsidian.ts
│   └── fixtures/
└── .github/workflows/{ci.yml, release.yml}
```

### Tooling
- **TypeScript + esbuild** (Obsidian sample-plugin pattern).
- Outputs: `main.js`, `manifest.json`, `styles.css`.
- `pnpm dev` → watch mode; `pnpm build` → production minified bundle.

### Manifest
```json
{
  "id": "obsidian-git-sync",
  "name": "Git Sync",
  "version": "0.1.0",
  "minAppVersion": "1.5.0",
  "description": "Sync your vault to a Git remote with configurable triggers and conflict handling.",
  "author": "JinYoung Ha",
  "authorUrl": "https://github.com/jyha81",
  "isDesktopOnly": true
}
```

### Dependency policy
- **Runtime dependencies: 0**. All git invocations through Node's built-in `child_process`.
- **Dev only**: `typescript`, `esbuild`, `vitest`, `@types/node`, `eslint`, `prettier`, `obsidian` (types).
- Rationale: zero runtime deps directly serves the "stability" goal — there is no upstream library that can break the plugin.

### Distribution
- **Stage 1 — BRAT**: install via the BRAT plugin (already present in `medi-jyha-note`). Suitable for personal / trusted-beta use indefinitely.
- **Stage 2 — Community Plugins (optional)**: PR to `community-plugins.json` only if/when broader distribution is desired.

### Local dev setup (one-time)
```
git clone <repo> ~/Dev/obsidian-git-sync
cd ~/Dev/obsidian-git-sync
pnpm install
ln -s ~/Dev/obsidian-git-sync \
      ~/Dev/medi-jyha-note/.obsidian/plugins/obsidian-git-sync
pnpm dev
```
The vault git repo must ignore plugin build artifacts. Add `.obsidian/plugins/obsidian-git-sync/main.js` (and `.gitignore` inside the plugin folder) to the vault `.gitignore`.

## 9. Out of Scope (v1) / Future

- Mobile (iOS/Android) sync.
- `conflict.onConflict = 'isolate'` strategy (move local work to `conflict/<timestamp>` branch automatically).
- Repository bootstrap wizard (init/clone/configure remote from settings).
- Squashing daily auto-commits.
- "Stale manual commit" warning.
- Public Community Plugins listing.

## 10. Open Questions

None at spec sign-off. Design choices fully resolved during brainstorming.
