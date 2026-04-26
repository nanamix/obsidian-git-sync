import type { GitResult } from '../git/GitRunner';

export enum ErrorKind {
  Ok = 'Ok',
  Conflict = 'Conflict',
  PushRejected = 'PushRejected',
  NetworkError = 'NetworkError',
  AuthError = 'AuthError',
  UnknownError = 'UnknownError',
}

const CONFLICT_RE = /CONFLICT\s|\bMerge conflict in\b|could not apply/i;
const PUSH_REJECTED_RE = /\bnon-fast-forward\b|\[rejected\]/i;
const NETWORK_RE = /Could not resolve host|Connection timed out|unable to access|Failed to connect/i;
const AUTH_RE = /Permission denied|Authentication failed|publickey|Invalid username/i;

export function classifyError(result: GitResult): ErrorKind {
  if (result.exitCode === 0) return ErrorKind.Ok;
  const blob = `${result.stdout}\n${result.stderr}`;
  if (CONFLICT_RE.test(blob)) return ErrorKind.Conflict;
  if (PUSH_REJECTED_RE.test(blob)) return ErrorKind.PushRejected;
  if (NETWORK_RE.test(blob)) return ErrorKind.NetworkError;
  if (AUTH_RE.test(blob)) return ErrorKind.AuthError;
  return ErrorKind.UnknownError;
}
