import { spawn } from 'node:child_process';
import type { GitResult, GitRunner } from './GitRunner';

export interface RealGitRunnerOptions {
  cwd: string;
  /** Optional log hook called once per invocation, after completion. */
  onResult?: (result: GitResult) => void;
  /** Hard timeout per invocation. Defaults to 5 minutes. */
  timeoutMs?: number;
}

export class RealGitRunner implements GitRunner {
  constructor(private readonly opts: RealGitRunnerOptions) {}

  run(args: ReadonlyArray<string>): Promise<GitResult> {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const child = spawn('git', args as string[], {
        cwd: this.opts.cwd,
        env: process.env,
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, this.opts.timeoutMs ?? 5 * 60_000);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        const result: GitResult = {
          exitCode: timedOut ? 124 : (code ?? -1),
          stdout,
          stderr: timedOut ? `${stderr}\n[killed: timeout exceeded]` : stderr,
          args,
          durationMs: Date.now() - start,
        };
        this.opts.onResult?.(result);
        resolve(result);
      });
    });
  }
}
