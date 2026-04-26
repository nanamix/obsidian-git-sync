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

export interface Preset {
  label: string;
  description: string;
  settings: DeepPartial<PluginSettings>;
}

export const PRESETS: Record<string, Preset> = {
  conservative: {
    label: 'Conservative',
    description:
      'Sync on Obsidian start and quit + manual. Best for first-time setup or single-device use.',
    settings: {
      triggers: {
        onWorkspaceReady: true,
        onAppQuit: true,
        interval: { enabled: false, minutes: 5 },
        onModifyDebounce: { enabled: false, seconds: 30 },
      },
      conflict: { pullStrategy: 'rebase', onConflict: 'block' },
      commit: {
        template: '[auto] {{hostname}} {{datetime}} ({{stats}})',
        includeFileListInBody: false,
      },
      safety: {
        quitTimeoutSeconds: 30,
        refuseIfDetachedHead: true,
        refuseIfBranchMismatch: true,
      },
      debug: {
        logToFile: true,
        logFilePath: '.obsidian/plugins/obsidian-git-sync/sync.log',
      },
    },
  },
  active: {
    label: 'Active automation',
    description:
      'Conservative + 10-minute interval. Best for multi-device use where you want near-realtime sync.',
    settings: {
      triggers: {
        onWorkspaceReady: true,
        onAppQuit: true,
        interval: { enabled: true, minutes: 10 },
        onModifyDebounce: { enabled: false, seconds: 30 },
      },
      conflict: { pullStrategy: 'rebase', onConflict: 'block' },
      commit: {
        template: '[auto] {{hostname}} {{datetime}} ({{stats}})',
        includeFileListInBody: false,
      },
      safety: {
        quitTimeoutSeconds: 30,
        refuseIfDetachedHead: true,
        refuseIfBranchMismatch: true,
      },
      debug: {
        logToFile: true,
        logFilePath: '.obsidian/plugins/obsidian-git-sync/sync.log',
      },
    },
  },
};

/**
 * Apply a named preset on top of the user's current settings.
 * `repo` (branch/remote) is project-specific and never overwritten — only preset-defined
 * fields (triggers / conflict / commit / safety / debug) are replaced.
 */
export function applyPreset(current: PluginSettings, presetKey: keyof typeof PRESETS): PluginSettings {
  const preset = PRESETS[presetKey];
  return deepMerge(current, preset.settings);
}
