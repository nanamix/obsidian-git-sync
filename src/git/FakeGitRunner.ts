import type { GitResult, GitRunner } from './GitRunner';

type Responder = (args: ReadonlyArray<string>) => Partial<GitResult> | undefined;

export class FakeGitRunner implements GitRunner {
  readonly calls: ReadonlyArray<string>[] = [];
  private responders: Responder[] = [];
  private defaultResult: Partial<GitResult> = { exitCode: 0, stdout: '', stderr: '' };

  /** Register a responder. First responder whose return is non-undefined wins. */
  on(responder: Responder): this {
    this.responders.push(responder);
    return this;
  }

  /** Convenience: respond when args[0..n-1] match a prefix. */
  onArgs(prefix: ReadonlyArray<string>, result: Partial<GitResult>): this {
    return this.on((args) => {
      if (prefix.every((a, i) => args[i] === a)) return result;
      return undefined;
    });
  }

  setDefault(result: Partial<GitResult>): this {
    this.defaultResult = result;
    return this;
  }

  async run(args: ReadonlyArray<string>): Promise<GitResult> {
    (this.calls as ReadonlyArray<string>[]).push(args);
    for (const r of this.responders) {
      const out = r(args);
      if (out !== undefined) return this.materialize(args, out);
    }
    return this.materialize(args, this.defaultResult);
  }

  private materialize(args: ReadonlyArray<string>, partial: Partial<GitResult>): GitResult {
    return {
      exitCode: partial.exitCode ?? 0,
      stdout: partial.stdout ?? '',
      stderr: partial.stderr ?? '',
      args,
      durationMs: partial.durationMs ?? 0,
    };
  }
}
