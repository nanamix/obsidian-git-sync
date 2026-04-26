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
