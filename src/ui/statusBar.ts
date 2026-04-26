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
