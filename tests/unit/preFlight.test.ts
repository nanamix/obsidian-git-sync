// tests/unit/preFlight.test.ts
import { describe, it, expect } from 'vitest';
import { runPreFlight, PreFlightOutcome } from '../../src/sync/preFlight';
import { FakeGitRunner } from '../../src/git/FakeGitRunner';
import { DEFAULT_SETTINGS } from '../../src/settings/settings';

function fakeWith(overrides: Record<string, { exitCode?: number; stdout?: string; stderr?: string }>) {
  const fake = new FakeGitRunner();
  for (const [prefix, result] of Object.entries(overrides)) {
    fake.onArgs(prefix.split(' '), result);
  }
  return fake;
}

describe('runPreFlight', () => {
  it('OK when all checks pass', async () => {
    const fake = fakeWith({
      'rev-parse --is-inside-work-tree': { stdout: 'true\n' },
      'rev-parse --abbrev-ref HEAD': { stdout: 'main\n' },
      'status --porcelain -z': { stdout: '' },
    });
    const out = await runPreFlight(fake, DEFAULT_SETTINGS, '/vault');
    expect(out.outcome).toBe(PreFlightOutcome.Ok);
  });

  it('refuses when not a work tree', async () => {
    const fake = fakeWith({
      'rev-parse --is-inside-work-tree': { exitCode: 128, stderr: 'not a git repository' },
    });
    const out = await runPreFlight(fake, DEFAULT_SETTINGS, '/vault');
    expect(out.outcome).toBe(PreFlightOutcome.NotAGitRepo);
  });

  it('refuses on detached HEAD when guard enabled', async () => {
    const fake = fakeWith({
      'rev-parse --is-inside-work-tree': { stdout: 'true\n' },
      'rev-parse --abbrev-ref HEAD': { stdout: 'HEAD\n' },
    });
    const out = await runPreFlight(fake, DEFAULT_SETTINGS, '/vault');
    expect(out.outcome).toBe(PreFlightOutcome.DetachedHead);
  });

  it('refuses on branch mismatch when guard enabled', async () => {
    const fake = fakeWith({
      'rev-parse --is-inside-work-tree': { stdout: 'true\n' },
      'rev-parse --abbrev-ref HEAD': { stdout: 'feature-x\n' },
    });
    const out = await runPreFlight(fake, DEFAULT_SETTINGS, '/vault');
    expect(out.outcome).toBe(PreFlightOutcome.BranchMismatch);
  });

  it('refuses when conflict markers present', async () => {
    // We simulate by returning a porcelain entry whose UU status indicates unmerged.
    const fake = fakeWith({
      'rev-parse --is-inside-work-tree': { stdout: 'true\n' },
      'rev-parse --abbrev-ref HEAD': { stdout: 'main\n' },
      'status --porcelain -z': { stdout: 'UU notes/foo.md ' },
    });
    const out = await runPreFlight(fake, DEFAULT_SETTINGS, '/vault');
    expect(out.outcome).toBe(PreFlightOutcome.MergeMarkersPresent);
  });
});
