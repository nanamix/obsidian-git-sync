import { describe, it, expect } from 'vitest';
import { classifyError, ErrorKind } from '../../src/sync/errorClassifier';
import { STDERR_SAMPLES } from '../fixtures/stderr-samples';

function res(stderr: string, stdout = '', exitCode = 1) {
  return { exitCode, stdout, stderr, args: [], durationMs: 0 };
}

describe('classifyError', () => {
  it('returns Ok when exitCode is 0', () => {
    expect(classifyError(res('', '', 0))).toBe(ErrorKind.Ok);
  });

  it.each([
    ['conflict_rebase', ErrorKind.Conflict],
    ['conflict_merge', ErrorKind.Conflict],
  ])('classifies %s as Conflict', (key, expected) => {
    const sample = STDERR_SAMPLES[key as keyof typeof STDERR_SAMPLES];
    expect(classifyError(res('', sample))).toBe(expected); // CONFLICT in stdout
    expect(classifyError(res(sample, ''))).toBe(expected); // or stderr
  });

  it('classifies non-fast-forward push as PushRejected', () => {
    expect(classifyError(res(STDERR_SAMPLES.push_rejected))).toBe(ErrorKind.PushRejected);
  });

  it.each(['network_resolve', 'network_timeout', 'network_unable'] as const)(
    'classifies %s as NetworkError',
    (key) => {
      expect(classifyError(res(STDERR_SAMPLES[key]))).toBe(ErrorKind.NetworkError);
    },
  );

  it.each(['auth_publickey', 'auth_failed'] as const)(
    'classifies %s as AuthError',
    (key) => {
      expect(classifyError(res(STDERR_SAMPLES[key]))).toBe(ErrorKind.AuthError);
    },
  );

  it('classifies anything else as UnknownError', () => {
    expect(classifyError(res(STDERR_SAMPLES.unknown))).toBe(ErrorKind.UnknownError);
  });
});
