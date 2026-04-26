export interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  args: ReadonlyArray<string>;
  durationMs: number;
}

export interface GitRunner {
  /**
   * Run `git <args>` with cwd set to the vault path. Resolves with a structured
   * result regardless of exit code; rejects only on spawn failure (e.g., git not installed).
   */
  run(args: ReadonlyArray<string>): Promise<GitResult>;
}
