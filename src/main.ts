import { Plugin, Notice } from 'obsidian';
import path from 'node:path';
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
        return () => this.app.workspace.offref(ref);
      },
      onAppQuit: (cb) => {
        const ref = this.app.workspace.on('quit' as any, cb);
        this.registerEvent(ref);
        return () => this.app.workspace.offref(ref);
      },
      onVaultModify: (cb) => {
        const ref = this.app.vault.on('modify', () => cb());
        this.registerEvent(ref);
        return () => this.app.vault.offref(ref);
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

    // First-run prompt
    if (!confirmed) {
      this.triggers.pauseAutoTriggers();
      new Notice(
        `Git Sync installed. Auto-triggers paused. Review settings → "Git Sync", then run "Sync now" once to enable auto-triggers.`,
        0,
      );
    }

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
