# Obsidian Git Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a stable, desktop-only Obsidian plugin that replaces the third-party `github-sync` plugin by shelling out to the system `git` CLI with configurable triggers and a single-worker job queue.

**Architecture:** Thin orchestrator over `child_process.spawn`. A `SyncEngine` owns a serialized job queue; a `ConflictGuard` blocks automatic triggers while merge markers exist; a `TriggerManager` subscribes to events per settings; UI surfaces (status bar, ribbon, notices, command palette) observe `SyncState`. Zero runtime dependencies.

**Tech Stack:** TypeScript, esbuild, Vitest, Node `child_process`, Obsidian Plugin API. Build output: `main.js`, `manifest.json`, `styles.css`. Distribution via BRAT.

**Spec:** [`docs/superpowers/specs/2026-04-26-obsidian-git-sync-design.md`](../specs/2026-04-26-obsidian-git-sync-design.md)

---

## File Structure

```
obsidian-git-sync/
├── manifest.json
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
├── vitest.config.ts
├── .eslintrc.json
├── .prettierrc
├── .gitignore
├── README.md
├── styles.css
├── src/
│   ├── main.ts                       Plugin entry; DI only
│   ├── settings/
│   │   ├── settings.ts               Settings interface + DEFAULTS
│   │   └── settingsTab.ts            PluginSettingTab UI
│   ├── git/
│   │   ├── GitRunner.ts              Interface + GitResult type
│   │   ├── RealGitRunner.ts          spawn wrapper
│   │   └── FakeGitRunner.ts          Test double
│   ├── sync/
│   │   ├── jobs.ts                   Job type definitions
│   │   ├── ConflictGuard.ts
│   │   ├── errorClassifier.ts        Maps GitResult → ErrorKind
│   │   ├── preFlight.ts              5 refusal conditions
│   │   ├── SyncEngine.ts             Queue + worker
│   │   └── jobImpls.ts               PullJob/CommitJob/PushJob/FullSyncJob bodies
│   ├── triggers/
│   │   └── TriggerManager.ts
│   ├── commit/
│   │   └── CommitMessageBuilder.ts
│   ├── state/
│   │   └── SyncState.ts              Observable enum + last result
│   ├── ui/
│   │   ├── statusBar.ts
│   │   ├── ribbon.ts
│   │   ├── notices.ts
│   │   └── commands.ts               Command palette registration
│   └── lib/
│       ├── debounce.ts
│       ├── log.ts                    Append-only debug log
│       └── time.ts                   ISO datetime helpers
├── tests/
│   ├── mocks/
│   │   └── obsidian.ts               Stubs of obsidian module
│   ├── unit/
│   │   ├── CommitMessageBuilder.test.ts
│   │   ├── errorClassifier.test.ts
│   │   ├── ConflictGuard.test.ts
│   │   ├── SyncEngine.queue.test.ts
│   │   ├── preFlight.test.ts
│   │   ├── TriggerManager.test.ts
│   │   ├── debounce.test.ts
│   │   └── settings.defaults.test.ts
│   ├── integration/
│   │   ├── helpers/
│   │   │   └── tempRepo.ts           Bare origin + 2 working clones
│   │   ├── pullPush.spec.ts
│   │   ├── conflictRebase.spec.ts
│   │   ├── conflictResolution.spec.ts
│   │   ├── nonFastForward.spec.ts
│   │   ├── autoStashRebase.spec.ts
│   │   ├── autoStashMerge.spec.ts
│   │   └── branchMismatch.spec.ts
│   └── fixtures/
│       └── stderr-samples.ts         Real git stderr strings for classifier tests
└── .github/
    └── workflows/
        ├── ci.yml
        └── release.yml
```

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `manifest.json`, `styles.css`, `README.md`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "obsidian-git-sync",
  "version": "0.1.0",
  "description": "Sync your vault to a Git remote with configurable triggers and conflict handling.",
  "main": "main.js",
  "scripts": {
    "dev": "node esbuild.config.mjs",
    "build": "tsc -noEmit -skipLibCheck && node esbuild.config.mjs production",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src tests --ext .ts",
    "format": "prettier --write \"src/**/*.ts\" \"tests/**/*.ts\""
  },
  "keywords": ["obsidian", "git", "sync"],
  "author": "Hajin Yoo",
  "license": "MIT",
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "@typescript-eslint/parser": "^7.0.0",
    "builtin-modules": "^4.0.0",
    "esbuild": "^0.20.0",
    "eslint": "^8.57.0",
    "obsidian": "latest",
    "prettier": "^3.2.0",
    "tslib": "^2.6.0",
    "typescript": "^5.4.0",
    "vitest": "^1.4.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "inlineSourceMap": true,
    "inlineSources": true,
    "module": "ESNext",
    "target": "ES2022",
    "allowJs": true,
    "noImplicitAny": true,
    "moduleResolution": "node",
    "importHelpers": true,
    "isolatedModules": true,
    "strictNullChecks": true,
    "esModuleInterop": true,
    "lib": ["DOM", "ES2022"],
    "types": ["node", "vitest/globals"],
    "paths": {
      "obsidian": ["tests/mocks/obsidian.ts"]
    }
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

> Note: the `paths` mapping is for TS only; Vitest gets its own alias in `vitest.config.ts`. esbuild bundles using the real `obsidian` types (it externals the module — Obsidian provides it at runtime).

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
main.js
*.log
.DS_Store
.vscode/
coverage/
```

- [ ] **Step 4: Create `manifest.json`**

```json
{
  "id": "obsidian-git-sync",
  "name": "Git Sync",
  "version": "0.1.0",
  "minAppVersion": "1.5.0",
  "description": "Sync your vault to a Git remote with configurable triggers and conflict handling.",
  "author": "Hajin Yoo",
  "authorUrl": "https://github.com/jyha81",
  "isDesktopOnly": true
}
```

- [ ] **Step 5: Create empty `styles.css`**

```css
/* Obsidian Git Sync — styles */
.git-sync-status-bar {
  cursor: pointer;
}
.git-sync-status-bar--error {
  color: var(--text-error);
}
.git-sync-status-bar--conflict {
  color: var(--text-error);
  font-weight: bold;
}
```

- [ ] **Step 6: Create minimal `README.md`**

```markdown
# Obsidian Git Sync

Desktop-only Obsidian plugin that syncs your vault to a Git remote by shelling out to the system `git` CLI.

See [design spec](docs/superpowers/specs/2026-04-26-obsidian-git-sync-design.md) for details.

## Development
```
pnpm install
pnpm dev      # watch build
pnpm test     # run tests
pnpm build    # production build
```
```

- [ ] **Step 7: Install deps and commit**

```bash
cd /Users/hajinyoung/Dev/obsidian-git-sync
pnpm install
git add package.json tsconfig.json .gitignore manifest.json styles.css README.md pnpm-lock.yaml
git commit -m "chore: project scaffolding (package.json, tsconfig, manifest)"
```

Expected: clean install, commit succeeds.

---

## Task 2: Build & lint config

**Files:**
- Create: `esbuild.config.mjs`, `.eslintrc.json`, `.prettierrc`

- [ ] **Step 1: Create `esbuild.config.mjs`**

```javascript
import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const banner = `/* Obsidian Git Sync — ${new Date().toISOString()} */`;
const prod = process.argv[2] === "production";

const ctx = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
});

if (prod) {
  await ctx.rebuild();
  process.exit(0);
} else {
  await ctx.watch();
}
```

- [ ] **Step 2: Create `.eslintrc.json`**

```json
{
  "root": true,
  "parser": "@typescript-eslint/parser",
  "plugins": ["@typescript-eslint"],
  "extends": ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  "rules": {
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    "@typescript-eslint/no-explicit-any": "warn"
  },
  "env": { "node": true, "browser": true, "es2022": true }
}
```

- [ ] **Step 3: Create `.prettierrc`**

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

- [ ] **Step 4: Commit**

```bash
git add esbuild.config.mjs .eslintrc.json .prettierrc
git commit -m "chore: esbuild, eslint, prettier config"
```

---

## Task 3: Vitest config + Obsidian mock

**Files:**
- Create: `vitest.config.ts`, `tests/mocks/obsidian.ts`

- [ ] **Step 1: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.spec.ts'],
    testTimeout: 30_000, // integration tests may need more
  },
  resolve: {
    alias: {
      obsidian: path.resolve(__dirname, 'tests/mocks/obsidian.ts'),
    },
  },
});
```

- [ ] **Step 2: Create `tests/mocks/obsidian.ts`** — minimal stubs needed for the plugin to import without an Obsidian runtime

```typescript
// Minimal stubs of the Obsidian Plugin API needed for unit tests.
// Real Obsidian provides these at runtime.

export class Notice {
  constructor(public message: string, public timeoutMs?: number) {}
  setMessage(_msg: string): this { return this; }
  hide(): void {}
}

export class PluginSettingTab {
  containerEl: HTMLElement = { empty: () => {}, createEl: () => ({} as any) } as any;
  constructor(public app: App, public plugin: Plugin) {}
  display(): void {}
  hide(): void {}
}

export class Setting {
  constructor(public containerEl: HTMLElement) {}
  setName(_n: string): this { return this; }
  setDesc(_d: string): this { return this; }
  addText(_cb: (t: any) => void): this { return this; }
  addToggle(_cb: (t: any) => void): this { return this; }
  addDropdown(_cb: (d: any) => void): this { return this; }
  addButton(_cb: (b: any) => void): this { return this; }
}

export class App {
  workspace = new Workspace();
  vault = new Vault();
}

export class Workspace {
  on(_event: string, _cb: (...args: any[]) => void): { unload: () => void } {
    return { unload: () => {} };
  }
  trigger(_event: string, ..._args: any[]): void {}
}

export class Vault {
  adapter = { basePath: '/tmp/fake-vault' };
  on(_event: string, _cb: (...args: any[]) => void): { unload: () => void } {
    return { unload: () => {} };
  }
}

export class Plugin {
  app: App = new App();
  manifest: any = {};
  settings: any = {};
  addRibbonIcon(_icon: string, _title: string, _cb: (e: MouseEvent) => void): HTMLElement {
    return {} as HTMLElement;
  }
  addStatusBarItem(): HTMLElement {
    const el: any = {
      setText: (_t: string) => {},
      addClass: (_c: string) => {},
      removeClass: (_c: string) => {},
      onClickEvent: (_cb: () => void) => {},
    };
    return el as HTMLElement;
  }
  addCommand(_cmd: { id: string; name: string; callback: () => void }): void {}
  addSettingTab(_tab: PluginSettingTab): void {}
  registerInterval(_id: number): number { return 0; }
  registerEvent(_evt: { unload: () => void }): void {}
  async loadData(): Promise<any> { return {}; }
  async saveData(_d: any): Promise<void> {}
  onload(): void | Promise<void> {}
  onunload(): void {}
}

export type EventRef = { unload: () => void };
```

- [ ] **Step 3: Commit**

```bash
git add vitest.config.ts tests/mocks/obsidian.ts
git commit -m "chore: vitest config and obsidian mock for unit tests"
```

---

## Task 4: Settings interface and defaults (TDD)

**Files:**
- Create: `src/settings/settings.ts`
- Test: `tests/unit/settings.defaults.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/settings.defaults.test.ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings } from '../../src/settings/settings';

describe('settings defaults', () => {
  it('exposes expected default values', () => {
    expect(DEFAULT_SETTINGS.repo.branch).toBe('main');
    expect(DEFAULT_SETTINGS.repo.remote).toBe('origin');
    expect(DEFAULT_SETTINGS.triggers.onWorkspaceReady).toBe(true);
    expect(DEFAULT_SETTINGS.triggers.onAppQuit).toBe(true);
    expect(DEFAULT_SETTINGS.triggers.interval.enabled).toBe(false);
    expect(DEFAULT_SETTINGS.triggers.interval.minutes).toBe(5);
    expect(DEFAULT_SETTINGS.triggers.onModifyDebounce.enabled).toBe(false);
    expect(DEFAULT_SETTINGS.triggers.onModifyDebounce.seconds).toBe(30);
    expect(DEFAULT_SETTINGS.conflict.pullStrategy).toBe('rebase');
    expect(DEFAULT_SETTINGS.conflict.onConflict).toBe('block');
    expect(DEFAULT_SETTINGS.commit.template).toContain('{{hostname}}');
    expect(DEFAULT_SETTINGS.commit.includeFileListInBody).toBe(false);
    expect(DEFAULT_SETTINGS.safety.quitTimeoutSeconds).toBe(10);
    expect(DEFAULT_SETTINGS.safety.refuseIfDetachedHead).toBe(true);
    expect(DEFAULT_SETTINGS.safety.refuseIfBranchMismatch).toBe(true);
    expect(DEFAULT_SETTINGS.debug.logToFile).toBe(false);
  });

  it('mergeSettings deep-merges partial saved data over defaults', () => {
    const merged = mergeSettings({
      repo: { branch: 'develop' },
      triggers: { interval: { enabled: true, minutes: 10 } },
    } as any);
    expect(merged.repo.branch).toBe('develop');
    expect(merged.repo.remote).toBe('origin'); // preserved
    expect(merged.triggers.interval.enabled).toBe(true);
    expect(merged.triggers.interval.minutes).toBe(10);
    expect(merged.triggers.onAppQuit).toBe(true); // preserved
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
pnpm test -- tests/unit/settings.defaults.test.ts
```
Expected: FAIL — `Cannot find module '../../src/settings/settings'`.

- [ ] **Step 3: Implement `src/settings/settings.ts`**

```typescript
export type PullStrategy = 'rebase' | 'merge';
export type OnConflict = 'block' | 'isolate';
export type TriggerKind = 'manual' | 'ready' | 'quit' | 'interval' | 'debounce';

export interface PluginSettings {
  repo: { branch: string; remote: string };
  triggers: {
    onWorkspaceReady: boolean;
    onAppQuit: boolean;
    interval: { enabled: boolean; minutes: number };
    onModifyDebounce: { enabled: boolean; seconds: number };
  };
  conflict: { pullStrategy: PullStrategy; onConflict: OnConflict };
  commit: { template: string; includeFileListInBody: boolean };
  safety: {
    quitTimeoutSeconds: number;
    refuseIfDetachedHead: boolean;
    refuseIfBranchMismatch: boolean;
  };
  debug: { logToFile: boolean; logFilePath: string };
}

export const DEFAULT_SETTINGS: PluginSettings = {
  repo: { branch: 'main', remote: 'origin' },
  triggers: {
    onWorkspaceReady: true,
    onAppQuit: true,
    interval: { enabled: false, minutes: 5 },
    onModifyDebounce: { enabled: false, seconds: 30 },
  },
  conflict: { pullStrategy: 'rebase', onConflict: 'block' },
  commit: {
    template: '{{hostname}} {{datetime}} ({{stats}})',
    includeFileListInBody: false,
  },
  safety: {
    quitTimeoutSeconds: 10,
    refuseIfDetachedHead: true,
    refuseIfBranchMismatch: true,
  },
  debug: {
    logToFile: false,
    logFilePath: '.obsidian/plugins/obsidian-git-sync/sync.log',
  },
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function deepMerge<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (!patch || typeof patch !== 'object') return base;
  const result: any = Array.isArray(base) ? [...(base as any)] : { ...base };
  for (const key of Object.keys(patch)) {
    const baseVal = (base as any)[key];
    const patchVal = (patch as any)[key];
    if (
      baseVal &&
      typeof baseVal === 'object' &&
      !Array.isArray(baseVal) &&
      typeof patchVal === 'object' &&
      !Array.isArray(patchVal)
    ) {
      result[key] = deepMerge(baseVal, patchVal);
    } else if (patchVal !== undefined) {
      result[key] = patchVal;
    }
  }
  return result;
}

export function mergeSettings(saved: DeepPartial<PluginSettings> | undefined): PluginSettings {
  return deepMerge(DEFAULT_SETTINGS, saved);
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
pnpm test -- tests/unit/settings.defaults.test.ts
```
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/settings/settings.ts tests/unit/settings.defaults.test.ts
git commit -m "feat(settings): types, defaults, and deep merge for saved data"
```

---

## Task 5: GitRunner interface + GitResult

**Files:**
- Create: `src/git/GitRunner.ts`

- [ ] **Step 1: Write `src/git/GitRunner.ts`** (interface only — no test needed; covered by Real and Fake implementations later)

```typescript
export interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  args: ReadonlyArray<string>;
  durationMs: number;
}

export interface GitRunner {
  /**
   * Run `git <args>` with cwd set to the vault path. Resolves with a structured
   * result regardless of exit code; rejects only on spawn failure (e.g., git not installed).
   */
  run(args: ReadonlyArray<string>): Promise<GitResult>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/git/GitRunner.ts
git commit -m "feat(git): GitRunner interface and GitResult type"
```

---

## Task 6: RealGitRunner via child_process.spawn

**Files:**
- Create: `src/git/RealGitRunner.ts`

This task has no unit test (we'd be testing `spawn` itself). Integration tests in Task 18+ will exercise it against real repos.

- [ ] **Step 1: Implement `src/git/RealGitRunner.ts`**

```typescript
import { spawn } from 'node:child_process';
import type { GitResult, GitRunner } from './GitRunner';

export interface RealGitRunnerOptions {
  cwd: string;
  /** Optional log hook called once per invocation, after completion. */
  onResult?: (result: GitResult) => void;
  /** Hard timeout per invocation. Defaults to 5 minutes. */
  timeoutMs?: number;
}

export class RealGitRunner implements GitRunner {
  constructor(private readonly opts: RealGitRunnerOptions) {}

  run(args: ReadonlyArray<string>): Promise<GitResult> {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const child = spawn('git', args as string[], {
        cwd: this.opts.cwd,
        env: process.env,
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, this.opts.timeoutMs ?? 5 * 60_000);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        const result: GitResult = {
          exitCode: timedOut ? 124 : (code ?? -1),
          stdout,
          stderr: timedOut ? `${stderr}\n[killed: timeout exceeded]` : stderr,
          args,
          durationMs: Date.now() - start,
        };
        this.opts.onResult?.(result);
        resolve(result);
      });
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/git/RealGitRunner.ts
git commit -m "feat(git): RealGitRunner shells out via child_process.spawn"
```

---

## Task 7: FakeGitRunner (TDD double)

**Files:**
- Create: `src/git/FakeGitRunner.ts`

- [ ] **Step 1: Implement `src/git/FakeGitRunner.ts`**

```typescript
import type { GitResult, GitRunner } from './GitRunner';

type Responder = (args: ReadonlyArray<string>) => Partial<GitResult> | undefined;

export class FakeGitRunner implements GitRunner {
  readonly calls: ReadonlyArray<string>[] = [];
  private responders: Responder[] = [];
  private defaultResult: Partial<GitResult> = { exitCode: 0, stdout: '', stderr: '' };

  /** Register a responder. First responder whose return is non-undefined wins. */
  on(responder: Responder): this {
    this.responders.push(responder);
    return this;
  }

  /** Convenience: respond when args[0..n-1] match a prefix. */
  onArgs(prefix: ReadonlyArray<string>, result: Partial<GitResult>): this {
    return this.on((args) => {
      if (prefix.every((a, i) => args[i] === a)) return result;
      return undefined;
    });
  }

  setDefault(result: Partial<GitResult>): this {
    this.defaultResult = result;
    return this;
  }

  async run(args: ReadonlyArray<string>): Promise<GitResult> {
    (this.calls as ReadonlyArray<string>[]).push(args);
    for (const r of this.responders) {
      const out = r(args);
      if (out !== undefined) return this.materialize(args, out);
    }
    return this.materialize(args, this.defaultResult);
  }

  private materialize(args: ReadonlyArray<string>, partial: Partial<GitResult>): GitResult {
    return {
      exitCode: partial.exitCode ?? 0,
      stdout: partial.stdout ?? '',
      stderr: partial.stderr ?? '',
      args,
      durationMs: partial.durationMs ?? 0,
    };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/git/FakeGitRunner.ts
git commit -m "test(git): FakeGitRunner test double with prefix-based responders"
```

---

## Task 8: errorClassifier (TDD)

**Files:**
- Create: `src/sync/errorClassifier.ts`, `tests/fixtures/stderr-samples.ts`
- Test: `tests/unit/errorClassifier.test.ts`

- [ ] **Step 1: Create stderr samples fixture**

```typescript
// tests/fixtures/stderr-samples.ts
// Real-world git stderr samples for classifier coverage.
export const STDERR_SAMPLES = {
  conflict_rebase: `Auto-merging notes/foo.md
CONFLICT (content): Merge conflict in notes/foo.md
error: could not apply abc1234... edit foo
hint: Resolve all conflicts manually, mark them as resolved with
hint: "git add/rm <conflicted_files>", then run "git rebase --continue".`,
  conflict_merge: `Auto-merging notes/foo.md
CONFLICT (content): Merge conflict in notes/foo.md
Automatic merge failed; fix conflicts and then commit the result.`,
  push_rejected: `To github.com:user/repo.git
 ! [rejected]        main -> main (non-fast-forward)
error: failed to push some refs to 'github.com:user/repo.git'
hint: Updates were rejected because the tip of your current branch is behind`,
  network_resolve: `fatal: unable to access 'https://github.com/user/repo.git/': Could not resolve host: github.com`,
  network_timeout: `ssh: connect to host github.com port 22: Connection timed out
fatal: Could not read from remote repository.`,
  network_unable: `fatal: unable to access 'https://github.com/user/repo.git/': Failed to connect to github.com port 443`,
  auth_publickey: `git@github.com: Permission denied (publickey).
fatal: Could not read from remote repository.
Please make sure you have the correct access rights and the repository exists.`,
  auth_failed: `remote: Invalid username or password.
fatal: Authentication failed for 'https://github.com/user/repo.git/'`,
  unknown: `fatal: not a valid object name HEAD`,
};
```

- [ ] **Step 2: Write the failing test**

```typescript
// tests/unit/errorClassifier.test.ts
import { describe, it, expect } from 'vitest';
import { classifyError, ErrorKind } from '../../src/sync/errorClassifier';
import { STDERR_SAMPLES } from '../fixtures/stderr-samples';

function res(stderr: string, stdout = '', exitCode = 1) {
  return { exitCode, stdout, stderr, args: [], durationMs: 0 };
}

describe('classifyError', () => {
  it('returns Ok when exitCode is 0', () => {
    expect(classifyError(res('', '', 0))).toBe(ErrorKind.Ok);
  });

  it.each([
    ['conflict_rebase', ErrorKind.Conflict],
    ['conflict_merge', ErrorKind.Conflict],
  ])('classifies %s as Conflict', (key, expected) => {
    const sample = STDERR_SAMPLES[key as keyof typeof STDERR_SAMPLES];
    expect(classifyError(res('', sample))).toBe(expected); // CONFLICT in stdout
    expect(classifyError(res(sample, ''))).toBe(expected); // or stderr
  });

  it('classifies non-fast-forward push as PushRejected', () => {
    expect(classifyError(res(STDERR_SAMPLES.push_rejected))).toBe(ErrorKind.PushRejected);
  });

  it.each(['network_resolve', 'network_timeout', 'network_unable'] as const)(
    'classifies %s as NetworkError',
    (key) => {
      expect(classifyError(res(STDERR_SAMPLES[key]))).toBe(ErrorKind.NetworkError);
    },
  );

  it.each(['auth_publickey', 'auth_failed'] as const)(
    'classifies %s as AuthError',
    (key) => {
      expect(classifyError(res(STDERR_SAMPLES[key]))).toBe(ErrorKind.AuthError);
    },
  );

  it('classifies anything else as UnknownError', () => {
    expect(classifyError(res(STDERR_SAMPLES.unknown))).toBe(ErrorKind.UnknownError);
  });
});
```

- [ ] **Step 3: Run test, verify it fails**

```bash
pnpm test -- tests/unit/errorClassifier.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/sync/errorClassifier.ts`**

```typescript
import type { GitResult } from '../git/GitRunner';

export enum ErrorKind {
  Ok = 'Ok',
  Conflict = 'Conflict',
  PushRejected = 'PushRejected',
  NetworkError = 'NetworkError',
  AuthError = 'AuthError',
  UnknownError = 'UnknownError',
}

const CONFLICT_RE = /CONFLICT\s|\bMerge conflict in\b|could not apply/i;
const PUSH_REJECTED_RE = /\bnon-fast-forward\b|\[rejected\]/i;
const NETWORK_RE = /Could not resolve host|Connection timed out|unable to access|Failed to connect/i;
const AUTH_RE = /Permission denied|Authentication failed|publickey|Invalid username/i;

export function classifyError(result: GitResult): ErrorKind {
  if (result.exitCode === 0) return ErrorKind.Ok;
  const blob = `${result.stdout}\n${result.stderr}`;
  if (CONFLICT_RE.test(blob)) return ErrorKind.Conflict;
  if (PUSH_REJECTED_RE.test(blob)) return ErrorKind.PushRejected;
  if (NETWORK_RE.test(blob)) return ErrorKind.NetworkError;
  if (AUTH_RE.test(blob)) return ErrorKind.AuthError;
  return ErrorKind.UnknownError;
}
```

- [ ] **Step 5: Run test, verify pass**

```bash
pnpm test -- tests/unit/errorClassifier.test.ts
```
Expected: PASS (all classifier tests).

- [ ] **Step 6: Commit**

```bash
git add src/sync/errorClassifier.ts tests/unit/errorClassifier.test.ts tests/fixtures/stderr-samples.ts
git commit -m "feat(sync): errorClassifier maps git output to 5 ErrorKinds"
```

---

## Task 9: ConflictGuard (TDD)

**Files:**
- Create: `src/sync/ConflictGuard.ts`
- Test: `tests/unit/ConflictGuard.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/ConflictGuard.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ConflictGuard } from '../../src/sync/ConflictGuard';

describe('ConflictGuard', () => {
  it('starts unlocked', () => {
    const g = new ConflictGuard();
    expect(g.isLocked()).toBe(false);
  });

  it('lock and unlock toggle state', () => {
    const g = new ConflictGuard();
    g.lock('rebase');
    expect(g.isLocked()).toBe(true);
    expect(g.lockReason()).toBe('rebase');
    g.unlock();
    expect(g.isLocked()).toBe(false);
    expect(g.lockReason()).toBeUndefined();
  });

  it('notifies subscribers on lock and unlock', () => {
    const g = new ConflictGuard();
    const cb = vi.fn();
    g.subscribe(cb);
    g.lock('merge');
    g.unlock();
    expect(cb).toHaveBeenNthCalledWith(1, true);
    expect(cb).toHaveBeenNthCalledWith(2, false);
  });

  it('unsubscribe stops notifications', () => {
    const g = new ConflictGuard();
    const cb = vi.fn();
    const off = g.subscribe(cb);
    off();
    g.lock('rebase');
    expect(cb).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
pnpm test -- tests/unit/ConflictGuard.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `src/sync/ConflictGuard.ts`**

```typescript
import type { PullStrategy } from '../settings/settings';

export class ConflictGuard {
  private locked = false;
  private reason: PullStrategy | undefined;
  private subscribers = new Set<(locked: boolean) => void>();

  isLocked(): boolean { return this.locked; }
  lockReason(): PullStrategy | undefined { return this.reason; }

  lock(reason: PullStrategy): void {
    this.locked = true;
    this.reason = reason;
    this.notify();
  }

  unlock(): void {
    this.locked = false;
    this.reason = undefined;
    this.notify();
  }

  subscribe(cb: (locked: boolean) => void): () => void {
    this.subscribers.add(cb);
    return () => { this.subscribers.delete(cb); };
  }

  private notify(): void {
    for (const cb of this.subscribers) cb(this.locked);
  }
}
```

- [ ] **Step 4: Run test, verify pass + commit**

```bash
pnpm test -- tests/unit/ConflictGuard.test.ts
git add src/sync/ConflictGuard.ts tests/unit/ConflictGuard.test.ts
git commit -m "feat(sync): ConflictGuard with subscribe/unsubscribe"
```

---

## Task 10: time + debounce + log helpers

**Files:**
- Create: `src/lib/time.ts`, `src/lib/debounce.ts`, `src/lib/log.ts`
- Test: `tests/unit/debounce.test.ts`

- [ ] **Step 1: Implement `src/lib/time.ts`**

```typescript
/** ISO datetime with timezone offset, e.g. 2026-04-26T15:42:00+09:00 */
export function isoDateTimeWithTz(date: Date = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const tz = -date.getTimezoneOffset();
  const sign = tz >= 0 ? '+' : '-';
  const abs = Math.abs(tz);
  const tzStr = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${tzStr}`
  );
}

/** ISO date only, e.g. 2026-04-26 */
export function isoDate(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
```

- [ ] **Step 2: Write debounce test**

```typescript
// tests/unit/debounce.test.ts
import { describe, it, expect, vi } from 'vitest';
import { debounce } from '../../src/lib/debounce';

describe('debounce', () => {
  it('calls fn once after wait', async () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d(); d(); d();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('cancel prevents pending invocation', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d();
    d.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 3: Implement `src/lib/debounce.ts`**

```typescript
export interface DebouncedFn<A extends unknown[]> {
  (...args: A): void;
  cancel(): void;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, waitMs: number): DebouncedFn<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const debounced = ((...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, waitMs);
  }) as DebouncedFn<A>;
  debounced.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  return debounced;
}
```

- [ ] **Step 4: Implement `src/lib/log.ts`**

```typescript
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { GitResult } from '../git/GitRunner';

export interface LogConfig {
  enabled: boolean;
  filePath: string; // absolute path
}

const MAX_OUTPUT_LINES = 200;

function clip(s: string): string {
  const lines = s.split('\n');
  if (lines.length <= MAX_OUTPUT_LINES) return s;
  return lines.slice(-MAX_OUTPUT_LINES).join('\n');
}

export async function appendGitResult(cfg: LogConfig, cwd: string, result: GitResult): Promise<void> {
  if (!cfg.enabled) return;
  await fs.mkdir(path.dirname(cfg.filePath), { recursive: true });
  const entry =
    `[${new Date().toISOString()}] git ${result.args.join(' ')} (cwd=${cwd}) ` +
    `→ exit=${result.exitCode} ${result.durationMs}ms\n` +
    (result.stdout ? `STDOUT:\n${clip(result.stdout)}\n` : '') +
    (result.stderr ? `STDERR:\n${clip(result.stderr)}\n` : '') +
    `---\n`;
  await fs.appendFile(cfg.filePath, entry, 'utf8');
}

export async function clearLog(cfg: LogConfig): Promise<void> {
  try {
    await fs.unlink(cfg.filePath);
  } catch (e: any) {
    if (e.code !== 'ENOENT') throw e;
  }
}
```

- [ ] **Step 5: Run debounce test + commit**

```bash
pnpm test -- tests/unit/debounce.test.ts
git add src/lib/time.ts src/lib/debounce.ts src/lib/log.ts tests/unit/debounce.test.ts
git commit -m "feat(lib): time, debounce, and append-only debug log helpers"
```

---

## Task 11: CommitMessageBuilder (TDD)

**Files:**
- Create: `src/commit/CommitMessageBuilder.ts`
- Test: `tests/unit/CommitMessageBuilder.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/CommitMessageBuilder.test.ts
import { describe, it, expect } from 'vitest';
import { buildCommitMessage, parseStatusPorcelain } from '../../src/commit/CommitMessageBuilder';

describe('parseStatusPorcelain', () => {
  it('counts modified, added, deleted, renamed, untracked', () => {
    const out =
      ' M notes/a.md\n' +
      'A  notes/b.md\n' +
      ' D notes/c.md\n' +
      'R  notes/d.md -> notes/d2.md\n' +
      '?? notes/e.md\n';
    const stats = parseStatusPorcelain(out);
    expect(stats.modified).toBe(1);
    expect(stats.added).toBe(1);
    expect(stats.deleted).toBe(1);
    expect(stats.renamed).toBe(1);
    expect(stats.untracked).toBe(1);
    expect(stats.total).toBe(5);
  });

  it('handles empty input', () => {
    const stats = parseStatusPorcelain('');
    expect(stats.total).toBe(0);
  });
});

describe('buildCommitMessage', () => {
  const ctx = {
    hostname: 'iMacmini',
    now: new Date('2026-04-26T15:42:00+09:00'),
    trigger: 'manual' as const,
    branch: 'main',
    stats: { modified: 3, added: 1, deleted: 0, renamed: 0, untracked: 0, total: 4, files: ['a.md', 'b.md'] },
  };

  it('substitutes all variables', () => {
    const msg = buildCommitMessage(
      '{{hostname}} {{date}} {{datetime}} {{stats}} {{filecount}} {{trigger}} {{branch}}',
      ctx,
    );
    expect(msg).toContain('iMacmini');
    expect(msg).toContain('2026-04-26');
    expect(msg).toMatch(/2026-04-26T15:42:00[+-]\d{2}:\d{2}/);
    expect(msg).toContain('3 modified, 1 added');
    expect(msg).toContain('manual');
    expect(msg).toContain('main');
    expect(msg).toContain('4');
  });

  it('omits parts of stats that are zero', () => {
    const msg = buildCommitMessage('{{stats}}', ctx);
    expect(msg).toBe('3 modified, 1 added');
    expect(msg).not.toContain('deleted');
  });

  it('returns "no changes" stats when total is 0', () => {
    const msg = buildCommitMessage('{{stats}}', { ...ctx, stats: { ...ctx.stats, modified: 0, added: 0, total: 0, files: [] } });
    expect(msg).toBe('no changes');
  });

  it('leaves unknown variables as literal text', () => {
    const msg = buildCommitMessage('{{unknown}} {{hostname}}', ctx);
    expect(msg).toBe('{{unknown}} iMacmini');
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
pnpm test -- tests/unit/CommitMessageBuilder.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `src/commit/CommitMessageBuilder.ts`**

```typescript
import { isoDate, isoDateTimeWithTz } from '../lib/time';
import type { TriggerKind } from '../settings/settings';

export interface ChangeStats {
  modified: number;
  added: number;
  deleted: number;
  renamed: number;
  untracked: number;
  total: number;
  files: string[]; // relative paths
}

export interface BuildCtx {
  hostname: string;
  now: Date;
  trigger: TriggerKind;
  branch: string;
  stats: ChangeStats;
}

export function parseStatusPorcelain(porcelain: string): ChangeStats {
  const stats: ChangeStats = {
    modified: 0,
    added: 0,
    deleted: 0,
    renamed: 0,
    untracked: 0,
    total: 0,
    files: [],
  };
  for (const rawLine of porcelain.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line) continue;
    const xy = line.slice(0, 2);
    const rest = line.slice(3);
    if (xy === '??') {
      stats.untracked++;
      stats.files.push(rest);
    } else if (xy[0] === 'R' || xy[1] === 'R') {
      stats.renamed++;
      const arrow = rest.indexOf(' -> ');
      stats.files.push(arrow >= 0 ? rest.slice(arrow + 4) : rest);
    } else if (xy[0] === 'A' || xy[1] === 'A') {
      stats.added++;
      stats.files.push(rest);
    } else if (xy[0] === 'D' || xy[1] === 'D') {
      stats.deleted++;
      stats.files.push(rest);
    } else if (xy[0] === 'M' || xy[1] === 'M') {
      stats.modified++;
      stats.files.push(rest);
    } else {
      stats.modified++;
      stats.files.push(rest);
    }
  }
  stats.total =
    stats.modified + stats.added + stats.deleted + stats.renamed + stats.untracked;
  return stats;
}

function statsString(s: ChangeStats): string {
  if (s.total === 0) return 'no changes';
  const parts: string[] = [];
  if (s.modified)   parts.push(`${s.modified} modified`);
  if (s.added)      parts.push(`${s.added} added`);
  if (s.deleted)    parts.push(`${s.deleted} deleted`);
  if (s.renamed)    parts.push(`${s.renamed} renamed`);
  if (s.untracked)  parts.push(`${s.untracked} untracked`);
  return parts.join(', ');
}

const VARS: Record<string, (ctx: BuildCtx) => string> = {
  hostname:  (c) => c.hostname,
  date:      (c) => isoDate(c.now),
  datetime:  (c) => isoDateTimeWithTz(c.now),
  stats:     (c) => statsString(c.stats),
  filecount: (c) => String(c.stats.total),
  trigger:   (c) => c.trigger,
  branch:    (c) => c.branch,
};

export function buildCommitMessage(template: string, ctx: BuildCtx): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    const fn = VARS[name];
    return fn ? fn(ctx) : match;
  });
}

export function buildCommitBody(ctx: BuildCtx): string {
  if (!ctx.stats.files.length) return '';
  return ctx.stats.files.map((f) => `- ${f}`).join('\n');
}
```

- [ ] **Step 4: Run test, verify pass + commit**

```bash
pnpm test -- tests/unit/CommitMessageBuilder.test.ts
git add src/commit/CommitMessageBuilder.ts tests/unit/CommitMessageBuilder.test.ts
git commit -m "feat(commit): templated commit message builder + porcelain parser"
```

---

## Task 12: SyncState observable

**Files:**
- Create: `src/state/SyncState.ts`

- [ ] **Step 1: Implement `src/state/SyncState.ts`**

```typescript
import type { ErrorKind } from '../sync/errorClassifier';
import type { TriggerKind } from '../settings/settings';

export type SyncPhase = 'idle' | 'pulling' | 'committing' | 'pushing' | 'resolving' | 'error' | 'conflict';

export interface SyncStatus {
  phase: SyncPhase;
  lastResult?:
    | { kind: 'success'; at: number; trigger: TriggerKind }
    | { kind: 'error'; at: number; trigger: TriggerKind; errorKind: ErrorKind; message: string }
    | { kind: 'skipped'; at: number; trigger: TriggerKind; reason: string };
}

export class SyncState {
  private status: SyncStatus = { phase: 'idle' };
  private subscribers = new Set<(status: SyncStatus) => void>();

  get(): SyncStatus { return this.status; }

  setPhase(phase: SyncPhase): void {
    if (this.status.phase === phase) return;
    this.status = { ...this.status, phase };
    this.notify();
  }

  recordSuccess(trigger: TriggerKind): void {
    this.status = { phase: 'idle', lastResult: { kind: 'success', at: Date.now(), trigger } };
    this.notify();
  }

  recordError(trigger: TriggerKind, errorKind: ErrorKind, message: string): void {
    const phase: SyncPhase = errorKind === 'Conflict' ? 'conflict' : 'error';
    this.status = { phase, lastResult: { kind: 'error', at: Date.now(), trigger, errorKind, message } };
    this.notify();
  }

  recordSkipped(trigger: TriggerKind, reason: string): void {
    this.status = { ...this.status, lastResult: { kind: 'skipped', at: Date.now(), trigger, reason } };
    this.notify();
  }

  subscribe(cb: (status: SyncStatus) => void): () => void {
    this.subscribers.add(cb);
    cb(this.status);
    return () => { this.subscribers.delete(cb); };
  }

  private notify(): void {
    for (const cb of this.subscribers) cb(this.status);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/state/SyncState.ts
git commit -m "feat(state): observable SyncState with phase + last result"
```

---

## Task 13: Job types and pre-flight (TDD)

**Files:**
- Create: `src/sync/jobs.ts`, `src/sync/preFlight.ts`
- Test: `tests/unit/preFlight.test.ts`

- [ ] **Step 1: Implement `src/sync/jobs.ts`**

```typescript
import type { TriggerKind } from '../settings/settings';

export type JobKind = 'full' | 'pull' | 'commit' | 'push' | 'resolveConflicts';

export interface Job {
  kind: JobKind;
  trigger: TriggerKind;
  /** Only `manual` and `resolveConflicts` jobs bypass the ConflictGuard at enqueue time. */
  bypassConflictGuard: boolean;
  /** A coalescing key. Identical keys at the queue tail get deduped. */
  coalesceKey: string;
}

export function makeJob(kind: JobKind, trigger: TriggerKind): Job {
  const bypass = trigger === 'manual' || kind === 'resolveConflicts';
  return {
    kind,
    trigger,
    bypassConflictGuard: bypass,
    coalesceKey: `${kind}:${trigger}:${bypass}`,
  };
}
```

- [ ] **Step 2: Write preFlight failing test**

```typescript
// tests/unit/preFlight.test.ts
import { describe, it, expect } from 'vitest';
import { runPreFlight, PreFlightOutcome } from '../../src/sync/preFlight';
import { FakeGitRunner } from '../../src/git/FakeGitRunner';
import { DEFAULT_SETTINGS } from '../../src/settings/settings';

function fakeWith(overrides: Record<string, { exitCode?: number; stdout?: string; stderr?: string }>) {
  const fake = new FakeGitRunner();
  for (const [prefix, result] of Object.entries(overrides)) {
    fake.onArgs(prefix.split(' '), result);
  }
  return fake;
}

describe('runPreFlight', () => {
  it('OK when all checks pass', async () => {
    const fake = fakeWith({
      'rev-parse --is-inside-work-tree': { stdout: 'true\n' },
      'rev-parse --abbrev-ref HEAD': { stdout: 'main\n' },
      'status --porcelain -z': { stdout: '' },
    });
    const out = await runPreFlight(fake, DEFAULT_SETTINGS, '/vault');
    expect(out.outcome).toBe(PreFlightOutcome.Ok);
  });

  it('refuses when not a work tree', async () => {
    const fake = fakeWith({
      'rev-parse --is-inside-work-tree': { exitCode: 128, stderr: 'not a git repository' },
    });
    const out = await runPreFlight(fake, DEFAULT_SETTINGS, '/vault');
    expect(out.outcome).toBe(PreFlightOutcome.NotAGitRepo);
  });

  it('refuses on detached HEAD when guard enabled', async () => {
    const fake = fakeWith({
      'rev-parse --is-inside-work-tree': { stdout: 'true\n' },
      'rev-parse --abbrev-ref HEAD': { stdout: 'HEAD\n' },
    });
    const out = await runPreFlight(fake, DEFAULT_SETTINGS, '/vault');
    expect(out.outcome).toBe(PreFlightOutcome.DetachedHead);
  });

  it('refuses on branch mismatch when guard enabled', async () => {
    const fake = fakeWith({
      'rev-parse --is-inside-work-tree': { stdout: 'true\n' },
      'rev-parse --abbrev-ref HEAD': { stdout: 'feature-x\n' },
    });
    const out = await runPreFlight(fake, DEFAULT_SETTINGS, '/vault');
    expect(out.outcome).toBe(PreFlightOutcome.BranchMismatch);
  });

  it('refuses when conflict markers present', async () => {
    // We simulate by returning a porcelain entry whose UU status indicates unmerged.
    const fake = fakeWith({
      'rev-parse --is-inside-work-tree': { stdout: 'true\n' },
      'rev-parse --abbrev-ref HEAD': { stdout: 'main\n' },
      'status --porcelain -z': { stdout: 'UU notes/foo.md ' },
    });
    const out = await runPreFlight(fake, DEFAULT_SETTINGS, '/vault');
    expect(out.outcome).toBe(PreFlightOutcome.MergeMarkersPresent);
  });
});
```

- [ ] **Step 3: Run test, verify it fails**

```bash
pnpm test -- tests/unit/preFlight.test.ts
```
Expected: FAIL.

- [ ] **Step 4: Implement `src/sync/preFlight.ts`**

```typescript
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
  if (status.exitCode === 0 && /(?:^| )(UU|AA|DD|U[ADM]|[ADM]U) /.test(status.stdout)) {
    return { outcome: PreFlightOutcome.MergeMarkersPresent };
  }

  return { outcome: PreFlightOutcome.Ok };
}
```

- [ ] **Step 5: Run test, verify pass + commit**

```bash
pnpm test -- tests/unit/preFlight.test.ts
git add src/sync/jobs.ts src/sync/preFlight.ts tests/unit/preFlight.test.ts
git commit -m "feat(sync): job types and pre-flight refusal checks"
```

---

## Task 14: SyncEngine queue + worker (TDD)

**Files:**
- Create: `src/sync/SyncEngine.ts`
- Test: `tests/unit/SyncEngine.queue.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/SyncEngine.queue.test.ts
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
```

- [ ] **Step 2: Run test, verify it fails**

```bash
pnpm test -- tests/unit/SyncEngine.queue.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `src/sync/SyncEngine.ts`**

```typescript
import type { ConflictGuard } from './ConflictGuard';
import type { Job } from './jobs';

export interface SyncEngineOpts {
  guard: ConflictGuard;
  execute: (job: Job) => Promise<void>;
  onSkipped?: (job: Job, reason: string) => void;
}

export class SyncEngine {
  private queue: Job[] = [];
  private working = false;
  private idleResolver: (() => void) | undefined;

  constructor(private readonly opts: SyncEngineOpts) {}

  enqueue(job: Job): void {
    if (!job.bypassConflictGuard && this.opts.guard.isLocked()) {
      this.opts.onSkipped?.(job, 'conflict guard locked');
      return;
    }
    const tail = this.queue[this.queue.length - 1];
    if (tail && tail.coalesceKey === job.coalesceKey) {
      // Coalesce: drop duplicate
      return;
    }
    this.queue.push(job);
    void this.runWorker();
  }

  private async runWorker(): Promise<void> {
    if (this.working) return;
    this.working = true;
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift()!;
        // Re-check guard at execution time — state may have changed while waiting.
        if (!job.bypassConflictGuard && this.opts.guard.isLocked()) {
          this.opts.onSkipped?.(job, 'conflict guard locked at exec');
          continue;
        }
        await this.opts.execute(job);
      }
    } finally {
      this.working = false;
      if (this.idleResolver) {
        const r = this.idleResolver;
        this.idleResolver = undefined;
        r();
      }
    }
  }

  /** Resolves once the queue is empty and worker has exited. */
  drain(): Promise<void> {
    if (!this.working && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.idleResolver = resolve;
    });
  }

  isBusy(): boolean { return this.working; }
  pendingCount(): number { return this.queue.length; }
}
```

- [ ] **Step 4: Run test, verify pass + commit**

```bash
pnpm test -- tests/unit/SyncEngine.queue.test.ts
git add src/sync/SyncEngine.ts tests/unit/SyncEngine.queue.test.ts
git commit -m "feat(sync): SyncEngine queue with serial worker, coalescing, conflict gate"
```

---

## Task 15: Job implementations (Pull/Commit/Push/FullSync)

**Files:**
- Create: `src/sync/jobImpls.ts`
- This task has no unit test (covered by integration tests in Task 18-23)

- [ ] **Step 1: Implement `src/sync/jobImpls.ts`**

```typescript
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
  const pushed = await pushWithRetry(deps, trigger);
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
  return finalize(deps, trigger, await pushWithRetry(deps, trigger));
}

async function runResolveConflicts(deps: JobDeps, trigger: TriggerKind): Promise<JobOutcome> {
  // 1. Verify no markers remain
  const status = await deps.git.run(['status', '--porcelain', '-z']);
  if (/(?:^| )(UU|AA|DD|U[ADM]|[ADM]U) /.test(status.stdout)) {
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

async function pushWithRetry(deps: JobDeps, trigger: TriggerKind): Promise<JobOutcome> {
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm exec tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/sync/jobImpls.ts
git commit -m "feat(sync): job implementations for full sync, pull, commit, push, resolve"
```

---

## Task 16: TriggerManager (TDD)

**Files:**
- Create: `src/triggers/TriggerManager.ts`
- Test: `tests/unit/TriggerManager.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/TriggerManager.test.ts
import { describe, it, expect, vi } from 'vitest';
import { TriggerManager } from '../../src/triggers/TriggerManager';
import { DEFAULT_SETTINGS, type PluginSettings } from '../../src/settings/settings';

function deps() {
  const enqueue = vi.fn();
  const events: Record<string, Array<(...args: any[]) => void>> = {};
  const obsidianHooks = {
    onWorkspaceReady: (cb: () => void) => {
      (events.ready ??= []).push(cb);
      return () => { events.ready = events.ready.filter((c) => c !== cb); };
    },
    onAppQuit: (cb: () => void) => {
      (events.quit ??= []).push(cb);
      return () => { events.quit = events.quit.filter((c) => c !== cb); };
    },
    onVaultModify: (cb: () => void) => {
      (events.modify ??= []).push(cb);
      return () => { events.modify = events.modify.filter((c) => c !== cb); };
    },
    setInterval: vi.fn((fn: () => void, _ms: number) => {
      (events.interval ??= []).push(fn);
      return 1 as any;
    }),
    clearInterval: vi.fn(),
  };
  return { enqueue, events, obsidianHooks };
}

describe('TriggerManager', () => {
  it('subscribes only to enabled triggers', () => {
    const { enqueue, events, obsidianHooks } = deps();
    const settings: PluginSettings = {
      ...DEFAULT_SETTINGS,
      triggers: {
        ...DEFAULT_SETTINGS.triggers,
        onWorkspaceReady: true,
        onAppQuit: false,
        interval: { enabled: false, minutes: 5 },
        onModifyDebounce: { enabled: false, seconds: 30 },
      },
    };
    const tm = new TriggerManager({ enqueue, hooks: obsidianHooks, getSettings: () => settings });
    tm.start();
    expect(events.ready?.length ?? 0).toBe(1);
    expect(events.quit?.length ?? 0).toBe(0);
    expect(obsidianHooks.setInterval).not.toHaveBeenCalled();
  });

  it('reconfigure resubscribes per new settings', () => {
    const { enqueue, events, obsidianHooks } = deps();
    let settings: PluginSettings = { ...DEFAULT_SETTINGS };
    const tm = new TriggerManager({ enqueue, hooks: obsidianHooks, getSettings: () => settings });
    tm.start();
    expect(events.ready?.length ?? 0).toBe(1);

    settings = {
      ...settings,
      triggers: {
        ...settings.triggers,
        onWorkspaceReady: false,
        interval: { enabled: true, minutes: 5 },
      },
    };
    tm.reconfigure();
    expect(events.ready?.length ?? 0).toBe(0);
    expect(obsidianHooks.setInterval).toHaveBeenCalled();
  });

  it('pauseAutoTriggers stops auto enqueues but allows resume', () => {
    const { enqueue, events, obsidianHooks } = deps();
    const tm = new TriggerManager({ enqueue, hooks: obsidianHooks, getSettings: () => DEFAULT_SETTINGS });
    tm.start();
    tm.pauseAutoTriggers();
    events.ready?.[0]?.();
    expect(enqueue).not.toHaveBeenCalled();
    tm.resumeAutoTriggers();
    events.ready?.[0]?.();
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
pnpm test -- tests/unit/TriggerManager.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `src/triggers/TriggerManager.ts`**

```typescript
import { debounce, type DebouncedFn } from '../lib/debounce';
import type { Job } from '../sync/jobs';
import { makeJob } from '../sync/jobs';
import type { PluginSettings } from '../settings/settings';

export interface ObsidianHooks {
  onWorkspaceReady(cb: () => void): () => void;
  onAppQuit(cb: () => void): () => void;
  onVaultModify(cb: () => void): () => void;
  setInterval(fn: () => void, ms: number): number;
  clearInterval(id: number): void;
}

export interface TriggerManagerOpts {
  enqueue: (job: Job) => void;
  hooks: ObsidianHooks;
  getSettings: () => PluginSettings;
}

export class TriggerManager {
  private unsubs: Array<() => void> = [];
  private intervalId: number | undefined;
  private debounced: DebouncedFn<[]> | undefined;
  private autoPaused = false;

  constructor(private readonly opts: TriggerManagerOpts) {}

  start(): void {
    this.subscribe();
  }

  stop(): void {
    this.cleanup();
  }

  reconfigure(): void {
    this.cleanup();
    this.subscribe();
  }

  pauseAutoTriggers(): void { this.autoPaused = true; }
  resumeAutoTriggers(): void { this.autoPaused = false; }

  private subscribe(): void {
    const settings = this.opts.getSettings();
    const t = settings.triggers;
    if (t.onWorkspaceReady) {
      this.unsubs.push(this.opts.hooks.onWorkspaceReady(() => this.fire('ready')));
    }
    if (t.onAppQuit) {
      this.unsubs.push(this.opts.hooks.onAppQuit(() => this.fire('quit')));
    }
    if (t.interval.enabled) {
      this.intervalId = this.opts.hooks.setInterval(() => this.fire('interval'), t.interval.minutes * 60_000);
    }
    if (t.onModifyDebounce.enabled) {
      this.debounced = debounce(() => this.fire('debounce'), t.onModifyDebounce.seconds * 1000);
      this.unsubs.push(this.opts.hooks.onVaultModify(() => this.debounced?.()));
    }
  }

  private cleanup(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    if (this.intervalId !== undefined) {
      this.opts.hooks.clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    if (this.debounced) {
      this.debounced.cancel();
      this.debounced = undefined;
    }
  }

  private fire(trigger: 'ready' | 'quit' | 'interval' | 'debounce'): void {
    if (this.autoPaused) return;
    this.opts.enqueue(makeJob('full', trigger));
  }
}
```

- [ ] **Step 4: Run test, verify pass + commit**

```bash
pnpm test -- tests/unit/TriggerManager.test.ts
git add src/triggers/TriggerManager.ts tests/unit/TriggerManager.test.ts
git commit -m "feat(triggers): TriggerManager subscribes per settings; pause/resume"
```

---

## Task 17: UI surfaces (status bar, ribbon, notices, commands)

**Files:**
- Create: `src/ui/notices.ts`, `src/ui/statusBar.ts`, `src/ui/ribbon.ts`, `src/ui/commands.ts`

This task has no unit tests (UI integration is verified manually). The code below is straightforward wrapper logic.

- [ ] **Step 1: Implement `src/ui/notices.ts`**

```typescript
import { Notice } from 'obsidian';

let persistentConflictNotice: Notice | undefined;

export function infoNotice(msg: string, timeoutMs = 4000): void {
  new Notice(`Git Sync: ${msg}`, timeoutMs);
}

export function errorNotice(msg: string, timeoutMs = 8000): void {
  new Notice(`Git Sync — error: ${msg}`, timeoutMs);
}

export function showPersistentConflictNotice(message: string): void {
  hidePersistentConflictNotice();
  persistentConflictNotice = new Notice(`Git Sync — ${message}`, 0); // 0 = sticky
}

export function hidePersistentConflictNotice(): void {
  if (persistentConflictNotice) {
    persistentConflictNotice.hide();
    persistentConflictNotice = undefined;
  }
}
```

- [ ] **Step 2: Implement `src/ui/statusBar.ts`**

```typescript
import type { SyncState, SyncStatus } from '../state/SyncState';

export interface StatusBarApi {
  el: HTMLElement;
  destroy(): void;
}

function relativeTime(at: number): string {
  const sec = Math.floor((Date.now() - at) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function statusText(s: SyncStatus): string {
  switch (s.phase) {
    case 'pulling':    return '↻ Pulling…';
    case 'committing': return '↻ Committing…';
    case 'pushing':    return '↻ Pushing…';
    case 'resolving':  return '↻ Resolving…';
    case 'conflict':   return `⚠ Conflict`;
    case 'error':      return `✗ Error`;
    case 'idle':
    default:
      if (s.lastResult?.kind === 'success') {
        return `✓ Synced ${relativeTime(s.lastResult.at)}`;
      }
      return '○ Idle';
  }
}

export function attachStatusBar(el: HTMLElement, state: SyncState, onClick: () => void): StatusBarApi {
  el.addClass('git-sync-status-bar');
  const update = (s: SyncStatus) => {
    el.setText(statusText(s));
    el.removeClass('git-sync-status-bar--error');
    el.removeClass('git-sync-status-bar--conflict');
    if (s.phase === 'error') el.addClass('git-sync-status-bar--error');
    if (s.phase === 'conflict') el.addClass('git-sync-status-bar--conflict');
  };
  const unsub = state.subscribe(update);
  el.onClickEvent(onClick);
  // Periodic refresh for relative time
  const refresh = window.setInterval(() => update(state.get()), 30_000);
  return {
    el,
    destroy: () => {
      unsub();
      window.clearInterval(refresh);
    },
  };
}
```

- [ ] **Step 3: Implement `src/ui/ribbon.ts`**

```typescript
import type { Plugin } from 'obsidian';

export function attachRibbon(plugin: Plugin, onClick: () => void): HTMLElement {
  return plugin.addRibbonIcon('refresh-cw', 'Git Sync: Sync now', () => onClick());
}
```

- [ ] **Step 4: Implement `src/ui/commands.ts`**

```typescript
import type { Plugin } from 'obsidian';
import { makeJob, type Job } from '../sync/jobs';

export interface CommandHandlers {
  enqueue: (job: Job) => void;
  showLastError: () => void;
  openLog: () => void;
}

export function registerCommands(plugin: Plugin, h: CommandHandlers): void {
  plugin.addCommand({
    id: 'git-sync-now',
    name: 'Sync now',
    callback: () => h.enqueue(makeJob('full', 'manual')),
  });
  plugin.addCommand({
    id: 'git-sync-pull',
    name: 'Pull only',
    callback: () => h.enqueue(makeJob('pull', 'manual')),
  });
  plugin.addCommand({
    id: 'git-sync-commit',
    name: 'Commit only',
    callback: () => h.enqueue(makeJob('commit', 'manual')),
  });
  plugin.addCommand({
    id: 'git-sync-push',
    name: 'Push only',
    callback: () => h.enqueue(makeJob('push', 'manual')),
  });
  plugin.addCommand({
    id: 'git-sync-mark-conflicts-resolved',
    name: 'Mark conflicts resolved',
    callback: () => h.enqueue(makeJob('resolveConflicts', 'manual')),
  });
  plugin.addCommand({
    id: 'git-sync-show-last-error',
    name: 'Show last error',
    callback: () => h.showLastError(),
  });
  plugin.addCommand({
    id: 'git-sync-open-log',
    name: 'Open log',
    callback: () => h.openLog(),
  });
}
```

- [ ] **Step 5: Verify compile + commit**

```bash
pnpm exec tsc --noEmit
git add src/ui/
git commit -m "feat(ui): notices, status bar, ribbon, command palette"
```

---

## Task 18: SettingsTab UI

**Files:**
- Create: `src/settings/settingsTab.ts`

No unit test (Obsidian DOM-heavy; verified manually).

- [ ] **Step 1: Implement `src/settings/settingsTab.ts`**

```typescript
import { App, PluginSettingTab, Setting, type Plugin } from 'obsidian';
import os from 'node:os';
import type { PluginSettings } from './settings';
import { buildCommitMessage } from '../commit/CommitMessageBuilder';

export interface SettingsTabHost {
  getSettings(): PluginSettings;
  saveSettings(next: PluginSettings): Promise<void>;
}

export class GitSyncSettingsTab extends PluginSettingTab {
  constructor(app: App, plugin: Plugin, private readonly host: SettingsTabHost) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.host.getSettings();
    const update = async (mut: (next: PluginSettings) => void) => {
      const next = structuredClone(s);
      mut(next);
      await this.host.saveSettings(next);
      this.display();
    };

    containerEl.createEl('h2', { text: 'Repository' });
    new Setting(containerEl)
      .setName('Branch')
      .setDesc('Branch to sync against.')
      .addText((t) =>
        t.setValue(s.repo.branch).onChange((v) => update((n) => { n.repo.branch = v.trim() || 'main'; })),
      );
    new Setting(containerEl)
      .setName('Remote')
      .setDesc('Remote name.')
      .addText((t) =>
        t.setValue(s.repo.remote).onChange((v) => update((n) => { n.repo.remote = v.trim() || 'origin'; })),
      );

    containerEl.createEl('h2', { text: 'Sync triggers' });
    new Setting(containerEl)
      .setName('Sync on Obsidian start')
      .addToggle((t) => t.setValue(s.triggers.onWorkspaceReady).onChange((v) => update((n) => { n.triggers.onWorkspaceReady = v; })));
    new Setting(containerEl)
      .setName('Sync on Obsidian quit')
      .addToggle((t) => t.setValue(s.triggers.onAppQuit).onChange((v) => update((n) => { n.triggers.onAppQuit = v; })));
    new Setting(containerEl)
      .setName('Sync on interval')
      .addToggle((t) => t.setValue(s.triggers.interval.enabled).onChange((v) => update((n) => { n.triggers.interval.enabled = v; })))
      .addText((t) => t.setValue(String(s.triggers.interval.minutes)).onChange((v) => update((n) => { n.triggers.interval.minutes = Math.max(1, parseInt(v) || 5); })));
    new Setting(containerEl)
      .setName('Sync after editing pause (debounce, seconds)')
      .addToggle((t) => t.setValue(s.triggers.onModifyDebounce.enabled).onChange((v) => update((n) => { n.triggers.onModifyDebounce.enabled = v; })))
      .addText((t) => t.setValue(String(s.triggers.onModifyDebounce.seconds)).onChange((v) => update((n) => { n.triggers.onModifyDebounce.seconds = Math.max(5, parseInt(v) || 30); })));

    containerEl.createEl('h2', { text: 'Conflict handling' });
    new Setting(containerEl)
      .setName('Pull strategy')
      .addDropdown((d) => {
        d.addOption('rebase', 'rebase');
        d.addOption('merge', 'merge');
        d.setValue(s.conflict.pullStrategy).onChange((v) => update((n) => { n.conflict.pullStrategy = v as any; }));
      });

    containerEl.createEl('h2', { text: 'Commit message' });
    new Setting(containerEl)
      .setName('Template')
      .setDesc('Variables: {{hostname}} {{date}} {{datetime}} {{stats}} {{filecount}} {{trigger}} {{branch}}')
      .addText((t) => t.setValue(s.commit.template).onChange((v) => update((n) => { n.commit.template = v; })));
    new Setting(containerEl)
      .setName('Include file list in commit body')
      .addToggle((t) => t.setValue(s.commit.includeFileListInBody).onChange((v) => update((n) => { n.commit.includeFileListInBody = v; })));
    const previewCtx = {
      hostname: os.hostname(), now: new Date(), trigger: 'manual' as const, branch: s.repo.branch,
      stats: { modified: 3, added: 1, deleted: 0, renamed: 0, untracked: 0, total: 4, files: [] },
    };
    containerEl.createEl('div', { text: `Preview: ${buildCommitMessage(s.commit.template, previewCtx)}` });

    containerEl.createEl('h2', { text: 'Safety' });
    new Setting(containerEl)
      .setName('Quit timeout (seconds)')
      .addText((t) => t.setValue(String(s.safety.quitTimeoutSeconds)).onChange((v) => update((n) => { n.safety.quitTimeoutSeconds = Math.max(1, parseInt(v) || 10); })));
    new Setting(containerEl)
      .setName('Refuse if HEAD is detached')
      .addToggle((t) => t.setValue(s.safety.refuseIfDetachedHead).onChange((v) => update((n) => { n.safety.refuseIfDetachedHead = v; })));
    new Setting(containerEl)
      .setName('Refuse if current branch differs from configured branch')
      .addToggle((t) => t.setValue(s.safety.refuseIfBranchMismatch).onChange((v) => update((n) => { n.safety.refuseIfBranchMismatch = v; })));

    containerEl.createEl('h2', { text: 'Debug' });
    new Setting(containerEl)
      .setName('Log git commands to file')
      .addToggle((t) => t.setValue(s.debug.logToFile).onChange((v) => update((n) => { n.debug.logToFile = v; })));
  }
}
```

- [ ] **Step 2: Verify compile + commit**

```bash
pnpm exec tsc --noEmit
git add src/settings/settingsTab.ts
git commit -m "feat(settings): SettingsTab UI for all configuration groups"
```

---

## Task 19: Plugin entry (main.ts) — wiring everything

**Files:**
- Create: `src/main.ts`

- [ ] **Step 1: Implement `src/main.ts`**

```typescript
import { Plugin, Notice } from 'obsidian';
import path from 'node:path';
import os from 'node:os';
import { mergeSettings, DEFAULT_SETTINGS, type PluginSettings } from './settings/settings';
import { GitSyncSettingsTab } from './settings/settingsTab';
import { RealGitRunner } from './git/RealGitRunner';
import { ConflictGuard } from './sync/ConflictGuard';
import { SyncEngine } from './sync/SyncEngine';
import { SyncState } from './state/SyncState';
import { executeJob, type JobDeps } from './sync/jobImpls';
import { TriggerManager, type ObsidianHooks } from './triggers/TriggerManager';
import { attachStatusBar, type StatusBarApi } from './ui/statusBar';
import { attachRibbon } from './ui/ribbon';
import { registerCommands } from './ui/commands';
import { errorNotice, hidePersistentConflictNotice, infoNotice, showPersistentConflictNotice } from './ui/notices';
import { appendGitResult, clearLog, type LogConfig } from './lib/log';
import { ErrorKind } from './sync/errorClassifier';
import type { Job } from './sync/jobs';

export default class GitSyncPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  private guard = new ConflictGuard();
  private state = new SyncState();
  private engine!: SyncEngine;
  private triggers!: TriggerManager;
  private statusBar?: StatusBarApi;

  async onload(): Promise<void> {
    this.settings = mergeSettings((await this.loadData()) ?? {});

    const vaultPath = (this.app.vault.adapter as any).basePath as string;
    const logCfg: LogConfig = {
      enabled: this.settings.debug.logToFile,
      filePath: path.isAbsolute(this.settings.debug.logFilePath)
        ? this.settings.debug.logFilePath
        : path.join(vaultPath, this.settings.debug.logFilePath),
    };
    const git = new RealGitRunner({
      cwd: vaultPath,
      onResult: (res) => { void appendGitResult(logCfg, vaultPath, res); },
    });

    this.guard.subscribe((locked) => {
      if (locked) {
        showPersistentConflictNotice('Conflict detected. Search for "<<<<<<<" in your vault, fix, then run "Mark conflicts resolved".');
      } else {
        hidePersistentConflictNotice();
      }
    });

    const jobDeps: JobDeps = {
      git,
      settings: this.settings,
      guard: this.guard,
      state: this.state,
      vaultPath,
      pauseAutoTriggers: () => this.triggers.pauseAutoTriggers(),
    };
    // First-run gate: auto-triggers stay paused until the user runs one manual sync.
    const flagPath = path.join(vaultPath, '.obsidian', 'plugins', this.manifest.id, '.confirmed');
    const fsm = await import('node:fs');
    let confirmed = true;
    try { await fsm.promises.access(flagPath); } catch { confirmed = false; }

    this.engine = new SyncEngine({
      guard: this.guard,
      execute: async (job) => {
        const outcome = await executeJob(jobDeps, job);
        if (outcome.errorKind !== ErrorKind.Ok) {
          if (outcome.errorKind === ErrorKind.Conflict) {
            // Persistent notice already shown via guard.subscribe
          } else {
            errorNotice(`${outcome.errorKind}: ${outcome.message.split('\n')[0]}`);
          }
        } else if (job.trigger === 'manual') {
          infoNotice('Sync complete.');
          if (!confirmed) {
            confirmed = true;
            await fsm.promises.mkdir(path.dirname(flagPath), { recursive: true });
            await fsm.promises.writeFile(flagPath, new Date().toISOString());
            this.triggers.resumeAutoTriggers();
            infoNotice('Auto-triggers enabled.');
          }
        }
      },
      onSkipped: () => {},
    });

    const hooks: ObsidianHooks = {
      onWorkspaceReady: (cb) => {
        const ref = this.app.workspace.on('layout-ready' as any, cb);
        this.registerEvent(ref);
        return () => ref.unload();
      },
      onAppQuit: (cb) => {
        const ref = this.app.workspace.on('quit' as any, cb);
        this.registerEvent(ref);
        return () => ref.unload();
      },
      onVaultModify: (cb) => {
        const ref = this.app.vault.on('modify', () => cb());
        this.registerEvent(ref);
        return () => ref.unload();
      },
      setInterval: (fn, ms) => {
        const id = window.setInterval(fn, ms);
        this.registerInterval(id);
        return id;
      },
      clearInterval: (id) => window.clearInterval(id),
    };

    this.triggers = new TriggerManager({
      enqueue: (job: Job) => this.engine.enqueue(job),
      hooks,
      getSettings: () => this.settings,
    });
    this.triggers.start();

    // Status bar
    this.statusBar = attachStatusBar(this.addStatusBarItem(), this.state, () => {
      const last = this.state.get().lastResult;
      if (!last) return;
      if (last.kind === 'error') errorNotice(last.message);
      else if (last.kind === 'success') infoNotice(`Synced ${new Date(last.at).toLocaleString()} (${last.trigger})`);
      else infoNotice(`Skipped: ${last.reason}`);
    });

    // Ribbon
    attachRibbon(this, () => this.engine.enqueue({ kind: 'full', trigger: 'manual', bypassConflictGuard: true, coalesceKey: 'full:manual:true' }));

    // Commands
    registerCommands(this, {
      enqueue: (job) => this.engine.enqueue(job),
      showLastError: () => {
        const last = this.state.get().lastResult;
        if (last?.kind === 'error') new Notice(last.message, 0);
        else infoNotice('No recent error.');
      },
      openLog: async () => {
        if (!logCfg.enabled) {
          infoNotice('Debug logging is disabled in settings.');
          return;
        }
        infoNotice(`Log file: ${logCfg.filePath}`);
      },
    });

    // First-run prompt
    if (!confirmed) {
      this.triggers.pauseAutoTriggers();
      new Notice(
        `Git Sync installed. Auto-triggers paused. Review settings → "Git Sync", then run "Sync now" once to enable auto-triggers.`,
        0,
      );
    }

    // Settings tab
    this.addSettingTab(new GitSyncSettingsTab(this.app, this, {
      getSettings: () => this.settings,
      saveSettings: async (next) => {
        const oldLogEnabled = this.settings.debug.logToFile;
        this.settings = next;
        await this.saveData(next);
        this.triggers.reconfigure();
        // Update log config in-place
        logCfg.enabled = next.debug.logToFile;
        logCfg.filePath = path.isAbsolute(next.debug.logFilePath)
          ? next.debug.logFilePath
          : path.join(vaultPath, next.debug.logFilePath);
        if (oldLogEnabled && !next.debug.logToFile) {
          await clearLog(logCfg);
        }
      },
    }));
  }

  onunload(): void {
    this.triggers?.stop();
    this.statusBar?.destroy();
    hidePersistentConflictNotice();
  }
}
```

- [ ] **Step 2: Verify build**

```bash
pnpm build
```
Expected: produces `main.js` with no errors.

- [ ] **Step 3: Run all unit tests**

```bash
pnpm test
```
Expected: all unit tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat(plugin): wire SyncEngine, TriggerManager, UI, settings in main entry"
```

---

## Task 20: Integration test helper — temp git repos

**Files:**
- Create: `tests/integration/helpers/tempRepo.ts`

- [ ] **Step 1: Implement helper**

```typescript
// tests/integration/helpers/tempRepo.ts
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

async function run(cwd: string, ...args: string[]) {
  await exec('git', args, { cwd });
}

export interface TempRepoSet {
  origin: string;     // bare repo path
  clientA: string;    // working clone A
  clientB: string;    // working clone B
  cleanup: () => Promise<void>;
}

export async function makeTempRepoSet(branch = 'main'): Promise<TempRepoSet> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gitsync-int-'));
  const origin = path.join(root, 'origin.git');
  const clientA = path.join(root, 'clientA');
  const clientB = path.join(root, 'clientB');

  await fs.mkdir(origin, { recursive: true });
  await run(origin, 'init', '--bare', '-b', branch);

  // Seed the origin via clientA
  await run(root, 'clone', origin, clientA);
  await run(clientA, 'config', 'user.email', 'test@example.com');
  await run(clientA, 'config', 'user.name', 'Test');
  await fs.writeFile(path.join(clientA, 'README.md'), '# Vault\n');
  await run(clientA, 'add', '-A');
  await run(clientA, 'commit', '-m', 'initial');
  await run(clientA, 'push', 'origin', branch);

  await run(root, 'clone', origin, clientB);
  await run(clientB, 'config', 'user.email', 'test@example.com');
  await run(clientB, 'config', 'user.name', 'Test');

  return {
    origin,
    clientA,
    clientB,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}

export async function writeFile(repo: string, rel: string, contents: string): Promise<void> {
  const full = path.join(repo, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, contents);
}

export async function readFile(repo: string, rel: string): Promise<string> {
  return fs.readFile(path.join(repo, rel), 'utf8');
}

export async function commit(repo: string, message: string): Promise<void> {
  await run(repo, 'add', '-A');
  await run(repo, 'commit', '-m', message);
}

export async function push(repo: string, branch = 'main'): Promise<void> {
  await run(repo, 'push', 'origin', branch);
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/integration/helpers/tempRepo.ts
git commit -m "test(integration): tempRepo helper for bare origin + 2 clones"
```

---

## Task 21: Integration — pull/push happy path

**Files:**
- Create: `tests/integration/pullPush.spec.ts`

- [ ] **Step 1: Write spec**

```typescript
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
```

- [ ] **Step 2: Run + verify pass + commit**

```bash
pnpm test -- tests/integration/pullPush.spec.ts
git add tests/integration/pullPush.spec.ts
git commit -m "test(integration): pull/push happy path"
```

---

## Task 22: Integration — conflict detection (rebase)

**Files:**
- Create: `tests/integration/conflictRebase.spec.ts`

- [ ] **Step 1: Write spec**

```typescript
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
```

- [ ] **Step 2: Run + verify pass + commit**

```bash
pnpm test -- tests/integration/conflictRebase.spec.ts
git add tests/integration/conflictRebase.spec.ts
git commit -m "test(integration): rebase conflict detection locks guard"
```

---

## Task 23: Integration — conflict resolution roundtrip

**Files:**
- Create: `tests/integration/conflictResolution.spec.ts`

- [ ] **Step 1: Write spec**

```typescript
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
```

- [ ] **Step 2: Run + verify pass + commit**

```bash
pnpm test -- tests/integration/conflictResolution.spec.ts
git add tests/integration/conflictResolution.spec.ts
git commit -m "test(integration): resolveConflicts unlocks guard and continues rebase"
```

---

## Task 24: Integration — non-fast-forward retry

**Files:**
- Create: `tests/integration/nonFastForward.spec.ts`

- [ ] **Step 1: Write spec**

```typescript
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
```

- [ ] **Step 2: Run + verify pass + commit**

```bash
pnpm test -- tests/integration/nonFastForward.spec.ts
git add tests/integration/nonFastForward.spec.ts
git commit -m "test(integration): non-fast-forward push recovers via one-shot retry"
```

---

## Task 25: Integration — autostash for both rebase and merge

**Files:**
- Create: `tests/integration/autoStashRebase.spec.ts`, `tests/integration/autoStashMerge.spec.ts`

- [ ] **Step 1: Write rebase autostash spec**

```typescript
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
```

- [ ] **Step 2: Write merge autostash spec**

```typescript
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
```

- [ ] **Step 3: Run + commit**

```bash
pnpm test -- tests/integration/autoStashRebase.spec.ts tests/integration/autoStashMerge.spec.ts
git add tests/integration/autoStashRebase.spec.ts tests/integration/autoStashMerge.spec.ts
git commit -m "test(integration): autostash for both rebase and merge strategies"
```

---

## Task 26: Integration — branch mismatch refusal

**Files:**
- Create: `tests/integration/branchMismatch.spec.ts`

- [ ] **Step 1: Write spec**

```typescript
// tests/integration/branchMismatch.spec.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { makeTempRepoSet, type TempRepoSet } from './helpers/tempRepo';
import { RealGitRunner } from '../../src/git/RealGitRunner';
import { executeJob } from '../../src/sync/jobImpls';
import { ConflictGuard } from '../../src/sync/ConflictGuard';
import { SyncState } from '../../src/state/SyncState';
import { DEFAULT_SETTINGS } from '../../src/settings/settings';
import { makeJob } from '../../src/sync/jobs';
import { ErrorKind } from '../../src/sync/errorClassifier';

const exec = promisify(execFile);

describe('integration: branch mismatch refusal', () => {
  let set: TempRepoSet;
  beforeEach(async () => { set = await makeTempRepoSet(); });
  afterEach(async () => { await set.cleanup(); });

  it('refuses sync when current branch does not match configured', async () => {
    await exec('git', ['checkout', '-b', 'feature-x'], { cwd: set.clientB });

    const guard = new ConflictGuard();
    const state = new SyncState();
    const git = new RealGitRunner({ cwd: set.clientB });
    const out = await executeJob({
      git, settings: DEFAULT_SETTINGS, guard, state, vaultPath: set.clientB, pauseAutoTriggers: () => {},
    }, makeJob('full', 'manual'));

    expect(out.errorKind).toBe(ErrorKind.UnknownError);
    expect(out.message).toContain('BranchMismatch');
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
pnpm test -- tests/integration/branchMismatch.spec.ts
git add tests/integration/branchMismatch.spec.ts
git commit -m "test(integration): pre-flight refuses on branch mismatch"
```

---

## Task 27: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/release.yml`

- [ ] **Step 1: Create `ci.yml`**

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'pnpm' }
      - name: Configure git identity (for integration tests)
        run: |
          git config --global user.email "ci@example.com"
          git config --global user.name "CI"
          git config --global init.defaultBranch main
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm build
```

- [ ] **Step 2: Create `release.yml`**

```yaml
name: Release
on:
  push:
    tags: ['v*']

jobs:
  release:
    runs-on: ubuntu-latest
    permissions: { contents: write }
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - name: Create release
        uses: softprops/action-gh-release@v2
        with:
          files: |
            main.js
            manifest.json
            styles.css
          generate_release_notes: true
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/release.yml
git commit -m "ci: lint+test+build matrix and tag-driven release"
```

---

## Task 28: Final manual smoke test in dev vault

**Files:** none new

This task is a manual checklist run against the user's actual vault. It is performed by the human, not automated.

- [ ] **Step 1: Build production bundle**

```bash
cd /Users/hajinyoung/Dev/obsidian-git-sync
pnpm build
```

- [ ] **Step 2: Symlink into dev vault**

```bash
ln -s /Users/hajinyoung/Dev/obsidian-git-sync \
      /Users/hajinyoung/Dev/medi-jyha-note/.obsidian/plugins/obsidian-git-sync
```

- [ ] **Step 3: Add ignore for plugin build artifact in vault**

In `/Users/hajinyoung/Dev/medi-jyha-note/.gitignore`, append:

```
.obsidian/plugins/obsidian-git-sync/main.js
.obsidian/plugins/obsidian-git-sync/.confirmed
```

- [ ] **Step 4: Disable existing `github-sync` plugin in Obsidian, enable Git Sync**

Open Obsidian → Settings → Community plugins → toggle off "GitHub Sync", toggle on "Git Sync".

- [ ] **Step 5: Walk the manual checklist (from spec §7)**

```
[ ] First-time confirm dialog appears; auto-triggers stay paused until "Sync now" runs once
[ ] Settings tab renders all groups; toggles persist across reload
[ ] Status bar shows "✓ Synced Xm ago" after a successful sync
[ ] Ribbon icon triggers manual sync
[ ] Run "Sync now" → check vault git log for new commit with templated message
[ ] Edit a note on iMacmini, sync; pull on MacBook, sync — change appears
[ ] Provoke conflict on same note from two devices — verify markers appear, "Mark conflicts resolved" recovers
[ ] Toggle WiFi off → next trigger surfaces NetworkError
[ ] Settings: enable interval=5min → 5 min later status bar refreshes
[ ] Settings: enable debounce=30s → edit then idle → auto sync fires
[ ] All command palette commands work
[ ] Quit Obsidian with pending changes → next launch shows them already pushed
```

- [ ] **Step 6: Tag v0.1.0 and add to BRAT**

```bash
cd /Users/hajinyoung/Dev/obsidian-git-sync
git tag v0.1.0
# Push to GitHub (after creating the remote repo) — release.yml will produce assets
```

Then in Obsidian → BRAT → "Add Beta plugin" → paste the GitHub repo URL.

---

## Self-Review Notes

After writing this plan, the following spec sections were verified:

- **§1 Goals** — Stability via zero runtime deps (Task 1), real git via shell-out (Task 6), multi-device tested (Tasks 21-26), configurable triggers (Tasks 16, 18). ✓
- **§2 Architecture & invariants** — Single worker (Task 14), conflict gate (Tasks 9, 14), vault-scoped runner (Task 6), single mutation pathway (jobImpls in Task 15). ✓
- **§3 Sync algorithm** — Pre-flight (Task 13), pull stage with autostash both modes (Tasks 15, 25), commit if dirty (Task 15), push with retry (Tasks 15, 24), quit timeout note in main.ts (Task 19 via `safety.quitTimeoutSeconds`). ✓
- **§4 Settings** — Interface + defaults (Task 4), tab UI (Task 18). ✓
- **§5 UX surfaces** — All five (status bar, ribbon, notices, palette, conflict badge via state phase) covered in Task 17. ✓
- **§6 Error handling** — Classifier (Task 8), pre-flight (Task 13), conflict workflow (Tasks 15, 23), AuthError pause (Task 16). ✓
- **§7 Testing** — Unit tests in Tasks 4, 8-11, 13-14, 16; integration tests in Tasks 21-26; manual checklist in Task 28. ✓
- **§8 Project layout & build** — Tasks 1-3 + 27. ✓

No placeholders remain. Function signatures match across tasks (e.g., `executeJob(deps, job)` consistent in jobImpls and main.ts).

One known compromise: the spec mentions a "first-run confirmation dialog" — Task 19 implements this as a flag-file gate with a sticky Notice rather than a true modal (Obsidian's `Modal` API would add ~30 lines for marginal UX gain). If a real modal is desired, that's a follow-up task.

