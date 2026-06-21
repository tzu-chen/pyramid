import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { resolveSessionCwd } from '../paths.js';

// Mirror of python-env.ts, but Cargo needs no "venv" — the package *is* the
// environment, scaffolded by rust-project.ts. This module is purely Cargo
// dependency management: list / add / remove crates and read/write Cargo.toml.

let cargoAvailableCache: boolean | null = null;

export interface CargoResult { stdout: string; stderr: string; exitCode: number | null }

export interface DeclaredDep { name: string; group: 'main' | 'dev'; spec: string }

const inFlight = new Set<string>();

function runCommand(cmd: string, args: string[], cwd: string, timeoutMs = 300000): Promise<CargoResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const proc = spawn(cmd, args, { cwd, env: { ...process.env, CARGO_TERM_COLOR: 'never' } });
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* dead */ } }, timeoutMs);
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => { clearTimeout(timer); resolve({ stdout, stderr, exitCode: code }); });
    proc.on('error', (err) => { clearTimeout(timer); resolve({ stdout, stderr: stderr + err.message, exitCode: null }); });
  });
}

// Heuristic Cargo.toml scan for declared dependencies (parity with python-env's
// parseDeclared on pyproject). Handles the inline form `cargo add` writes —
// `name = "1.0"` and `name = { version = "1", features = [...] }` — plus
// `[dependencies.name]` section headers.
function parseDeclared(dir: string): DeclaredDep[] {
  const tomlPath = path.join(dir, 'Cargo.toml');
  if (!fs.existsSync(tomlPath)) return [];
  let text: string;
  try { text = fs.readFileSync(tomlPath, 'utf8'); } catch { return []; }

  const deps: DeclaredDep[] = [];
  let group: 'main' | 'dev' | null = null;
  const headerRe = /^\[(dependencies|dev-dependencies)(?:\.([A-Za-z0-9_-]+))?\]\s*$/;
  const entryRe = /^([A-Za-z0-9_][A-Za-z0-9_-]*)\s*=\s*(.+?)\s*$/;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const header = line.match(headerRe);
    if (header) {
      group = header[1] === 'dev-dependencies' ? 'dev' : 'main';
      // `[dependencies.foo]` declares foo directly.
      if (header[2]) deps.push({ name: header[2], group, spec: '' });
      continue;
    }
    if (line.startsWith('[')) { group = null; continue; } // some other table
    if (!group) continue;
    const entry = line.match(entryRe);
    if (!entry) continue;
    const name = entry[1];
    const rawVal = entry[2];
    let spec = rawVal;
    if (rawVal.startsWith('"')) {
      spec = rawVal.replace(/^"|"$/g, '');
    } else if (rawVal.startsWith('{')) {
      const vm = rawVal.match(/version\s*=\s*"([^"]+)"/);
      spec = vm ? vm[1] : rawVal;
    }
    deps.push({ name, group, spec });
  }
  return deps;
}

interface CargoMetadata {
  packages?: Array<{ name: string; version: string; id: string }>;
  workspace_members?: string[];
}

export const cargoEnv = {
  cargoAvailable(): boolean {
    if (cargoAvailableCache !== null) return cargoAvailableCache;
    try {
      const r = spawnSync('cargo', ['--version'], { timeout: 3000 });
      cargoAvailableCache = r.status === 0;
    } catch {
      cargoAvailableCache = false;
    }
    return cargoAvailableCache;
  },

  hasProject(dir: string): boolean {
    return fs.existsSync(path.join(dir, 'Cargo.toml'));
  },

  // Mutex that waits (serialises cargo add/remove for one session).
  async runExclusive<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    while (inFlight.has(sessionId)) await new Promise((r) => setTimeout(r, 150));
    inFlight.add(sessionId);
    try { return await fn(); } finally { inFlight.delete(sessionId); }
  },

  // Resolved (transitive) dependency set from `cargo metadata`, minus the
  // workspace's own member crates — the analog of `pip list`.
  async resolvedList(dir: string): Promise<{ name: string; version: string }[]> {
    if (!this.hasProject(dir)) return [];
    const r = await runCommand('cargo', ['metadata', '--format-version', '1', '--quiet'], dir, 120000);
    if (r.exitCode !== 0) return [];
    try {
      const meta = JSON.parse(r.stdout) as CargoMetadata;
      const members = new Set(meta.workspace_members ?? []);
      return (meta.packages ?? [])
        .filter((p) => !members.has(p.id))
        .map((p) => ({ name: p.name, version: p.version }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  },

  async listPackages(workingDirRel: string): Promise<{ declared: DeclaredDep[]; installed: { name: string; version: string }[]; lockPresent: boolean }> {
    const dir = resolveSessionCwd(workingDirRel);
    const declared = parseDeclared(dir);
    const installed = await this.resolvedList(dir);
    return { declared, installed, lockPresent: fs.existsSync(path.join(dir, 'Cargo.lock')) };
  },

  addPackage(dir: string, spec: string, dev = false): Promise<CargoResult> {
    const args = ['add'];
    if (dev) args.push('--dev');
    args.push(spec);
    return runCommand('cargo', args, dir, 180000);
  },

  removePackage(dir: string, name: string): Promise<CargoResult> {
    return runCommand('cargo', ['remove', name], dir, 120000);
  },

  readManifest(dir: string): { manifest: string } {
    const p = path.join(dir, 'Cargo.toml');
    return { manifest: fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '' };
  },

  // Write Cargo.toml, then validate by resolving the graph (`cargo metadata`),
  // surfacing a bad edit as a non-zero exit with stderr — parity with uv sync.
  async writeManifest(dir: string, manifest: string): Promise<CargoResult> {
    fs.writeFileSync(path.join(dir, 'Cargo.toml'), manifest);
    return runCommand('cargo', ['metadata', '--format-version', '1', '--quiet'], dir, 120000);
  },
};
