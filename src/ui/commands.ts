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
