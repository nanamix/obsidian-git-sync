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
