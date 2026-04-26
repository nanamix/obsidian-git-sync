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
