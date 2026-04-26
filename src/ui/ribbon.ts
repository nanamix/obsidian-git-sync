import type { Plugin } from 'obsidian';

export function attachRibbon(plugin: Plugin, onClick: () => void): HTMLElement {
  return plugin.addRibbonIcon('refresh-cw', 'Git Sync: Sync now', () => onClick());
}
