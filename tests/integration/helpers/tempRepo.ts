import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

async function run(cwd: string, ...args: string[]) {
  await exec('git', args, { cwd });
}

export interface TempRepoSet {
  origin: string;     // bare repo path
  clientA: string;    // working clone A
  clientB: string;    // working clone B
  cleanup: () => Promise<void>;
}

export async function makeTempRepoSet(branch = 'main'): Promise<TempRepoSet> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gitsync-int-'));
  const origin = path.join(root, 'origin.git');
  const clientA = path.join(root, 'clientA');
  const clientB = path.join(root, 'clientB');

  await fs.mkdir(origin, { recursive: true });
  await run(origin, 'init', '--bare', '-b', branch);

  // Seed the origin via clientA
  await run(root, 'clone', origin, clientA);
  await run(clientA, 'config', 'user.email', 'test@example.com');
  await run(clientA, 'config', 'user.name', 'Test');
  await fs.writeFile(path.join(clientA, 'README.md'), '# Vault\n');
  await run(clientA, 'add', '-A');
  await run(clientA, 'commit', '-m', 'initial');
  await run(clientA, 'push', 'origin', branch);

  await run(root, 'clone', origin, clientB);
  await run(clientB, 'config', 'user.email', 'test@example.com');
  await run(clientB, 'config', 'user.name', 'Test');

  return {
    origin,
    clientA,
    clientB,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}

export async function writeFile(repo: string, rel: string, contents: string): Promise<void> {
  const full = path.join(repo, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, contents);
}

export async function readFile(repo: string, rel: string): Promise<string> {
  return fs.readFile(path.join(repo, rel), 'utf8');
}

export async function commit(repo: string, message: string): Promise<void> {
  await run(repo, 'add', '-A');
  await run(repo, 'commit', '-m', message);
}

export async function push(repo: string, branch = 'main'): Promise<void> {
  await run(repo, 'push', 'origin', branch);
}
