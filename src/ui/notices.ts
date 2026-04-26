import { Notice } from 'obsidian';

let persistentConflictNotice: Notice | undefined;

export function infoNotice(msg: string, timeoutMs = 4000): void {
  new Notice(`Git Sync: ${msg}`, timeoutMs);
}

export function errorNotice(msg: string, timeoutMs = 8000): void {
  new Notice(`Git Sync — error: ${msg}`, timeoutMs);
}

export function showPersistentConflictNotice(message: string): void {
  hidePersistentConflictNotice();
  persistentConflictNotice = new Notice(`Git Sync — ${message}`, 0); // 0 = sticky
}

export function hidePersistentConflictNotice(): void {
  if (persistentConflictNotice) {
    persistentConflictNotice.hide();
    persistentConflictNotice = undefined;
  }
}
