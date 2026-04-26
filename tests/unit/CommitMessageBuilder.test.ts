import { describe, it, expect } from 'vitest';
import { buildCommitMessage, parseStatusPorcelain } from '../../src/commit/CommitMessageBuilder';

describe('parseStatusPorcelain', () => {
  it('counts modified, added, deleted, renamed, untracked', () => {
    const out =
      ' M notes/a.md\n' +
      'A  notes/b.md\n' +
      ' D notes/c.md\n' +
      'R  notes/d.md -> notes/d2.md\n' +
      '?? notes/e.md\n';
    const stats = parseStatusPorcelain(out);
    expect(stats.modified).toBe(1);
    expect(stats.added).toBe(1);
    expect(stats.deleted).toBe(1);
    expect(stats.renamed).toBe(1);
    expect(stats.untracked).toBe(1);
    expect(stats.total).toBe(5);
  });

  it('handles empty input', () => {
    const stats = parseStatusPorcelain('');
    expect(stats.total).toBe(0);
  });
});

describe('buildCommitMessage', () => {
  const ctx = {
    hostname: 'iMacmini',
    now: new Date('2026-04-26T15:42:00+09:00'),
    trigger: 'manual' as const,
    branch: 'main',
    stats: { modified: 3, added: 1, deleted: 0, renamed: 0, untracked: 0, total: 4, files: ['a.md', 'b.md'] },
  };

  it('substitutes all variables', () => {
    const msg = buildCommitMessage(
      '{{hostname}} {{date}} {{datetime}} {{stats}} {{filecount}} {{trigger}} {{branch}}',
      ctx,
    );
    expect(msg).toContain('iMacmini');
    expect(msg).toContain('2026-04-26');
    // The Date is built from a timezone-fixed ISO string (KST +09:00), but
    // isoDateTimeWithTz formats in the *runner's* local timezone — so the
    // hour/minute and offset depend on TZ. Pin only the date and shape.
    expect(msg).toMatch(/2026-04-2[56]T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}/);
    expect(msg).toContain('3 modified, 1 added');
    expect(msg).toContain('manual');
    expect(msg).toContain('main');
    expect(msg).toContain('4');
  });

  it('omits parts of stats that are zero', () => {
    const msg = buildCommitMessage('{{stats}}', ctx);
    expect(msg).toBe('3 modified, 1 added');
    expect(msg).not.toContain('deleted');
  });

  it('returns "no changes" stats when total is 0', () => {
    const msg = buildCommitMessage('{{stats}}', { ...ctx, stats: { ...ctx.stats, modified: 0, added: 0, total: 0, files: [] } });
    expect(msg).toBe('no changes');
  });

  it('leaves unknown variables as literal text', () => {
    const msg = buildCommitMessage('{{unknown}} {{hostname}}', ctx);
    expect(msg).toBe('{{unknown}} iMacmini');
  });
});
