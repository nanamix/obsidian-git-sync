import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  PRESETS,
  applyPreset,
  type PluginSettings,
} from '../../src/settings/settings';

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

describe('presets', () => {
  it('exposes conservative and active presets with required fields', () => {
    expect(PRESETS.conservative).toBeDefined();
    expect(PRESETS.conservative.label).toBe('Conservative');
    expect(PRESETS.conservative.description).toContain('first-time');

    expect(PRESETS.active).toBeDefined();
    expect(PRESETS.active.label).toBe('Active automation');
    expect(PRESETS.active.description).toContain('multi-device');
  });

  it('conservative preset disables interval and debounce', () => {
    const s = PRESETS.conservative.settings;
    expect(s.triggers?.onWorkspaceReady).toBe(true);
    expect(s.triggers?.onAppQuit).toBe(true);
    expect(s.triggers?.interval?.enabled).toBe(false);
    expect(s.triggers?.onModifyDebounce?.enabled).toBe(false);
  });

  it('active preset enables a 10-minute interval', () => {
    const s = PRESETS.active.settings;
    expect(s.triggers?.interval?.enabled).toBe(true);
    expect(s.triggers?.interval?.minutes).toBe(10);
  });

  it('applyPreset overwrites preset-defined fields and preserves repo', () => {
    const current: PluginSettings = {
      ...DEFAULT_SETTINGS,
      repo: { branch: 'develop', remote: 'upstream' }, // user has customized repo
      triggers: {
        ...DEFAULT_SETTINGS.triggers,
        interval: { enabled: true, minutes: 60 }, // user had different interval
      },
    };
    const next = applyPreset(current, 'conservative');

    // repo preserved (preset doesn't define it)
    expect(next.repo.branch).toBe('develop');
    expect(next.repo.remote).toBe('upstream');

    // preset values applied (overwrote user's interval)
    expect(next.triggers.interval.enabled).toBe(false);
    expect(next.commit.template).toBe('[auto] {{hostname}} {{datetime}} ({{stats}})');
    expect(next.safety.quitTimeoutSeconds).toBe(30);
    expect(next.debug.logToFile).toBe(true);
  });

  it('applyPreset(active) enables interval with 10 minutes', () => {
    const next = applyPreset(DEFAULT_SETTINGS, 'active');
    expect(next.triggers.interval.enabled).toBe(true);
    expect(next.triggers.interval.minutes).toBe(10);
    expect(next.triggers.onWorkspaceReady).toBe(true);
  });
});
