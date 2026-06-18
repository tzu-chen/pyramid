import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { resolveSessionCwd } from '../paths.js';

// uv-managed *project* per python/notebook session: a pyproject.toml + uv.lock +
// .venv living in <working_dir>. It rides the existing working_dir model (DELETE
// session removes it; python_session_meta cascades). The .venv path is identical
// to the original venv-only scheme, so execution.ts and notebook-kernel.ts need
// no changes. Everything degrades to system python3 when uv is absent.

const DEFAULT_PYTHON = '3.12'; // wheel availability is better than 3.14 on this host
const PROJECT_NAME = 'pyramid-session'; // session dirs are UUIDs (invalid pkg names)
let uvAvailableCache: boolean | null = null;

// Per-session guard. scaffold/ensure use it as a skip-if-busy flag; package
// mutations (add/remove/sync/lock) use runExclusive to *wait* for the lock so
// they never clobber pyproject.toml / uv.lock concurrently.
const inFlight = new Set<string>();

function getCstTimestamp(): string {
  const now = new Date();
  const cst = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  return cst.toISOString().replace('Z', '-06:00');
}

function getSetting(key: string): string | null {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value?.trim() || null;
  } catch {
    return null;
  }
}

// Environment for every uv invocation. Threads an optional shared cache dir
// (uv already shares ~/.cache/uv by default; this only relocates it).
function uvEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const cacheDir = getSetting('uv_cache_dir');
  if (cacheDir) env.UV_CACHE_DIR = cacheDir;
  return env;
}

export interface UvResult { stdout: string; stderr: string; exitCode: number | null }

function runCommand(cmd: string, args: string[], cwd: string, timeoutMs = 300000): Promise<UvResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    const proc = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: uvEnv() });
    proc.stdin.end();
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      killed = true;
      proc.kill('SIGTERM');
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* */ } }, 2000);
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: killed ? null : code });
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ stdout: '', stderr: err.message, exitCode: null });
    });
  });
}

function setVenvStatus(sessionId: string, status: string, err = ''): void {
  db.prepare('UPDATE python_session_meta SET venv_status = ?, error_message = ?, updated_at = ? WHERE session_id = ?')
    .run(status, err, getCstTimestamp(), sessionId);
}

// Parse the top-level declared dependencies out of a pyproject.toml without a
// TOML lib. Line-anchored so `optional-dependencies` etc. don't leak in.
export interface DeclaredDep { name: string; group: 'main' | 'dev'; spec: string }
function parseDeclared(dir: string): DeclaredDep[] {
  const p = path.join(dir, 'pyproject.toml');
  if (!fs.existsSync(p)) return [];
  const toml = fs.readFileSync(p, 'utf-8');
  const out: DeclaredDep[] = [];
  const grab = (key: string, group: 'main' | 'dev') => {
    const m = toml.match(new RegExp(`^${key}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'm'));
    if (!m) return;
    const items = m[1].match(/"([^"]+)"|'([^']+)'/g) || [];
    for (const it of items) {
      const spec = it.replace(/['"]/g, '').trim();
      if (!spec) continue;
      const name = spec.split(/[<>=!~[\s;]/)[0].trim();
      if (name && !out.some(d => d.name === name)) out.push({ name, group, spec });
    }
  };
  grab('dependencies', 'main');
  grab('dev', 'dev');            // [dependency-groups] dev = [...]
  grab('dev-dependencies', 'dev'); // [tool.uv] dev-dependencies = [...]
  return out;
}

export const pythonEnv = {
  defaultPython: DEFAULT_PYTHON,

  uvAvailable(): boolean {
    if (uvAvailableCache !== null) return uvAvailableCache;
    try {
      const r = spawnSync('uv', ['--version'], { stdio: 'ignore' });
      uvAvailableCache = r.status === 0;
    } catch {
      uvAvailableCache = false;
    }
    return uvAvailableCache;
  },

  // Resolve the interpreter version: explicit request → global setting → default.
  // The result is passed as uv's `--python` argument, which also accepts an
  // interpreter *path* — so we only accept bare CPython requests like "3.12" or
  // "3.12.1" and fall back to the default for anything else (a path, a
  // leading-dash flag, shell metachars). The server is reachable over the LAN
  // (CORS *), so this is validated even though both inputs are "trusted" config.
  resolvePythonVersion(requested?: string | null): string {
    const v = ((requested && requested.trim()) || getSetting('python_default_version') || '').trim();
    return /^3\.\d{1,2}(\.\d{1,2})?$/.test(v) ? v : DEFAULT_PYTHON;
  },

  venvPython(workingDirRel: string): string | null {
    const p = path.join(resolveSessionCwd(workingDirRel), '.venv', 'bin', 'python');
    return fs.existsSync(p) ? p : null;
  },

  venvPythonAbs(absWorkingDir: string): string | null {
    const p = path.join(absWorkingDir, '.venv', 'bin', 'python');
    return fs.existsSync(p) ? p : null;
  },

  hasProject(dir: string): boolean {
    return fs.existsSync(path.join(dir, 'pyproject.toml'));
  },

  isProjectReady(workingDirRel: string): boolean {
    const dir = resolveSessionCwd(workingDirRel);
    return this.hasProject(dir) && !!this.venvPython(workingDirRel);
  },

  // Mutex that *waits* (for package ops), vs scaffold's skip-if-busy.
  async runExclusive<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    while (inFlight.has(sessionId)) await new Promise(r => setTimeout(r, 150));
    inFlight.add(sessionId);
    try { return await fn(); } finally { inFlight.delete(sessionId); }
  },

  // Bring a session's working dir to a ready uv project. Preserves an existing
  // (Tier-1) venv and its packages: for python it captures `uv pip freeze` and
  // re-declares it; for notebooks it (re)adds ipykernel as a dev dep. Throws on
  // a fatal uv failure. Does NOT touch meta status (callers own that).
  async buildProject(dir: string, isNotebook: boolean, version: string): Promise<void> {
    const venvExists = fs.existsSync(path.join(dir, '.venv'));
    const projExists = this.hasProject(dir);

    // Capture manual installs before init so a later `uv sync` can't prune them.
    // Skip for notebooks: their venv is just ipykernel + its closure, which we
    // reconstruct cleanly via `uv add --dev ipykernel`.
    let captured: string[] = [];
    if (venvExists && !projExists && !isNotebook) captured = await this.freezeRuntime(dir);

    if (!projExists) {
      const init = await runCommand('uv', ['init', '--bare', '--no-workspace', '--name', PROJECT_NAME, '--python', version], dir);
      if (init.exitCode !== 0) throw new Error(`uv init failed: ${init.stderr.trim()}`);
    }
    if (!venvExists) {
      const venv = await runCommand('uv', ['venv', '--python', version, '.venv'], dir);
      if (venv.exitCode !== 0) throw new Error(`uv venv failed: ${venv.stderr.trim()}`);
    }

    if (isNotebook) {
      const k = await runCommand('uv', ['add', '--dev', 'ipykernel'], dir);
      if (k.exitCode !== 0) throw new Error(`uv add ipykernel failed: ${k.stderr.trim()}`);
    } else if (captured.length) {
      const add = await runCommand('uv', ['add', ...captured], dir);
      // Best-effort: if a pin can't resolve, fall back to a plain sync so the
      // project is at least valid (the user can fix specifics in the panel).
      if (add.exitCode !== 0) await runCommand('uv', ['sync'], dir);
    } else {
      const s = await runCommand('uv', ['sync'], dir);
      if (s.exitCode !== 0) throw new Error(`uv sync failed: ${s.stderr.trim()}`);
    }
  },

  // Installed package pins from the existing venv, minus tooling noise.
  async freezeRuntime(dir: string): Promise<string[]> {
    const r = await runCommand('uv', ['pip', 'freeze', '--python', '.venv/bin/python'], dir);
    if (r.exitCode !== 0) return [];
    return r.stdout.split('\n').map(s => s.trim())
      .filter(s => s && s.includes('==') && !s.startsWith('-e') && !s.includes(' @ '))
      .filter(s => !/^(pip|setuptools|wheel|uv)==/i.test(s));
  },

  // Background scaffold (create/open). Skips if a build is already running.
  async scaffoldProject(sessionId: string, workingDirRel: string, isNotebook: boolean, pythonVersion?: string): Promise<void> {
    if (!this.uvAvailable()) return;
    if (inFlight.has(sessionId)) return;
    inFlight.add(sessionId);
    const dir = resolveSessionCwd(workingDirRel);
    const version = this.resolvePythonVersion(pythonVersion);
    try {
      await this.buildProject(dir, isNotebook, version);
      setVenvStatus(sessionId, 'ready');
    } catch (err) {
      setVenvStatus(sessionId, 'error', (err as Error).message);
    } finally {
      inFlight.delete(sessionId);
    }
  },

  // Idempotent ensure on open/execute (Tier-1 callers in index.ts / execution.ts).
  // Upgrades pre-project sessions and recreates a missing venv. Non-blocking.
  ensureVenv(sessionId: string, workingDirRel: string, withIpykernel: boolean): void {
    if (!this.uvAvailable()) return;
    if (this.isProjectReady(workingDirRel)) return;
    if (inFlight.has(sessionId)) return;

    const now = getCstTimestamp();
    db.prepare(`
      INSERT OR IGNORE INTO python_session_meta (id, session_id, python_version, venv_status, created_at, updated_at)
      VALUES (?, ?, ?, 'initializing', ?, ?)
    `).run(uuidv4(), sessionId, DEFAULT_PYTHON, now, now);
    setVenvStatus(sessionId, 'initializing');

    const version = (db.prepare('SELECT python_version FROM python_session_meta WHERE session_id = ?')
      .get(sessionId) as { python_version: string } | undefined)?.python_version;
    this.scaffoldProject(sessionId, workingDirRel, withIpykernel, version).catch(() => { /* status set to error */ });
  },

  // ---- Package management (Tier 2) — callers should wrap in runExclusive ----

  async listPackages(workingDirRel: string): Promise<{ declared: DeclaredDep[]; installed: { name: string; version: string }[]; lockPresent: boolean }> {
    const dir = resolveSessionCwd(workingDirRel);
    const declared = parseDeclared(dir);
    const installed = await this.installedList(dir);
    return { declared, installed, lockPresent: fs.existsSync(path.join(dir, 'uv.lock')) };
  },

  async installedList(dir: string): Promise<{ name: string; version: string }[]> {
    if (!fs.existsSync(path.join(dir, '.venv', 'bin', 'python'))) return [];
    const r = await runCommand('uv', ['pip', 'list', '--format', 'json', '--python', '.venv/bin/python'], dir);
    if (r.exitCode !== 0) return [];
    try {
      return (JSON.parse(r.stdout) as { name: string; version: string }[])
        .map(p => ({ name: p.name, version: p.version }));
    } catch {
      return [];
    }
  },

  addPackage(dir: string, name: string, dev = false): Promise<UvResult> {
    const args = ['add'];
    if (dev) args.push('--dev');
    args.push(name);
    return runCommand('uv', args, dir, 120000);
  },

  removePackage(dir: string, name: string): Promise<UvResult> {
    return runCommand('uv', ['remove', name], dir, 120000);
  },

  syncProject(dir: string): Promise<UvResult> {
    return runCommand('uv', ['sync'], dir, 120000);
  },

  lockProject(dir: string): Promise<UvResult> {
    return runCommand('uv', ['lock'], dir, 120000);
  },

  readManifest(dir: string): { pyproject: string; lock: string | null } {
    const pp = path.join(dir, 'pyproject.toml');
    const lk = path.join(dir, 'uv.lock');
    return {
      pyproject: fs.existsSync(pp) ? fs.readFileSync(pp, 'utf-8') : '',
      lock: fs.existsSync(lk) ? fs.readFileSync(lk, 'utf-8') : null,
    };
  },

  async writeManifest(dir: string, pyproject: string): Promise<UvResult> {
    fs.writeFileSync(path.join(dir, 'pyproject.toml'), pyproject);
    return runCommand('uv', ['sync'], dir, 120000); // re-locks if out of date, then installs
  },

  pruneCache(): Promise<UvResult> {
    return runCommand('uv', ['cache', 'prune'], process.cwd(), 60000);
  },
};
