import { isoDate, isoDateTimeWithTz } from '../lib/time';
import type { TriggerKind } from '../settings/settings';

export interface ChangeStats {
  modified: number;
  added: number;
  deleted: number;
  renamed: number;
  untracked: number;
  total: number;
  files: string[]; // relative paths
}

export interface BuildCtx {
  hostname: string;
  now: Date;
  trigger: TriggerKind;
  branch: string;
  stats: ChangeStats;
}

export function parseStatusPorcelain(porcelain: string): ChangeStats {
  const stats: ChangeStats = {
    modified: 0,
    added: 0,
    deleted: 0,
    renamed: 0,
    untracked: 0,
    total: 0,
    files: [],
  };
  for (const rawLine of porcelain.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line) continue;
    const xy = line.slice(0, 2);
    const rest = line.slice(3);
    if (xy === '??') {
      stats.untracked++;
      stats.files.push(rest);
    } else if (xy[0] === 'R' || xy[1] === 'R') {
      stats.renamed++;
      const arrow = rest.indexOf(' -> ');
      stats.files.push(arrow >= 0 ? rest.slice(arrow + 4) : rest);
    } else if (xy[0] === 'A' || xy[1] === 'A') {
      stats.added++;
      stats.files.push(rest);
    } else if (xy[0] === 'D' || xy[1] === 'D') {
      stats.deleted++;
      stats.files.push(rest);
    } else if (xy[0] === 'M' || xy[1] === 'M') {
      stats.modified++;
      stats.files.push(rest);
    } else {
      stats.modified++;
      stats.files.push(rest);
    }
  }
  stats.total =
    stats.modified + stats.added + stats.deleted + stats.renamed + stats.untracked;
  return stats;
}

function statsString(s: ChangeStats): string {
  if (s.total === 0) return 'no changes';
  const parts: string[] = [];
  if (s.modified)   parts.push(`${s.modified} modified`);
  if (s.added)      parts.push(`${s.added} added`);
  if (s.deleted)    parts.push(`${s.deleted} deleted`);
  if (s.renamed)    parts.push(`${s.renamed} renamed`);
  if (s.untracked)  parts.push(`${s.untracked} untracked`);
  return parts.join(', ');
}

const VARS: Record<string, (ctx: BuildCtx) => string> = {
  hostname:  (c) => c.hostname,
  date:      (c) => isoDate(c.now),
  datetime:  (c) => isoDateTimeWithTz(c.now),
  stats:     (c) => statsString(c.stats),
  filecount: (c) => String(c.stats.total),
  trigger:   (c) => c.trigger,
  branch:    (c) => c.branch,
};

export function buildCommitMessage(template: string, ctx: BuildCtx): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    const fn = VARS[name];
    return fn ? fn(ctx) : match;
  });
}

export function buildCommitBody(ctx: BuildCtx): string {
  if (!ctx.stats.files.length) return '';
  return ctx.stats.files.map((f) => `- ${f}`).join('\n');
}
