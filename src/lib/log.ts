import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { GitResult } from '../git/GitRunner';

export interface LogConfig {
  enabled: boolean;
  filePath: string; // absolute path
}

const MAX_OUTPUT_LINES = 200;

function clip(s: string): string {
  const lines = s.split('\n');
  if (lines.length <= MAX_OUTPUT_LINES) return s;
  return lines.slice(-MAX_OUTPUT_LINES).join('\n');
}

export async function appendGitResult(cfg: LogConfig, cwd: string, result: GitResult): Promise<void> {
  if (!cfg.enabled) return;
  await fs.mkdir(path.dirname(cfg.filePath), { recursive: true });
  const entry =
    `[${new Date().toISOString()}] git ${result.args.join(' ')} (cwd=${cwd}) ` +
    `→ exit=${result.exitCode} ${result.durationMs}ms\n` +
    (result.stdout ? `STDOUT:\n${clip(result.stdout)}\n` : '') +
    (result.stderr ? `STDERR:\n${clip(result.stderr)}\n` : '') +
    `---\n`;
  await fs.appendFile(cfg.filePath, entry, 'utf8');
}

export async function clearLog(cfg: LogConfig): Promise<void> {
  try {
    await fs.unlink(cfg.filePath);
  } catch (e: any) {
    if (e.code !== 'ENOENT') throw e;
  }
}
