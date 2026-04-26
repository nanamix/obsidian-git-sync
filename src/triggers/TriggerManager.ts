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
