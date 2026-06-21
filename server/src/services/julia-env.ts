import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { resolveSessionCwd } from '../paths.js';
import { juliaProject } from './julia-project.js';

// Julia Pkg dependency management — the Pkg.jl analog of cargo-env.ts. The
// session's Project.toml *is* the environment (scaffolded by julia-project.ts);
// this module only lists / adds / removes packages and reads/writes Project.toml.
// The PackageList shape (declared / installed / lockPresent) is shared, so the
// generalized PackagesPanel renders uv, cargo, and Pkg from one component.

export interface JuliaResult { stdout: string; stderr: string; exitCode: number | null }

export interface DeclaredDep { name: string; group: 'main' | 'dev'; spec: string }

const inFlight = new Set<string>();

function runJulia(args: string[], cwd: string, timeoutMs = 300000): Promise<JuliaResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const proc = spawn('julia', args, {
      cwd,
      env: { ...process.env, JULIA_PKG_USE_CLI_GIT: 'false' },
    });
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* dead */ } }, timeoutMs);
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => { clearTimeout(timer); resolve({ stdout, stderr, exitCode: code }); });
    proc.on('error', (err) => { clearTimeout(timer); resolve({ stdout, stderr: stderr + err.message, exitCode: null }); });
  });
}

// Parse Project.toml for declared dependencies. `[deps]` → main, `[extras]` →
// dev (Julia's test-only deps), with version constraints picked up from
// `[compat]`. Each entry is `Name = "uuid-or-spec"`.
function parseDeclared(dir: string): DeclaredDep[] {
  const tomlPath = path.join(dir, 'Project.toml');
  if (!fs.existsSync(tomlPath)) return [];
  let text: string;
  try { text = fs.readFileSync(tomlPath, 'utf8'); } catch { return []; }

  const entries: { name: string; group: 'main' | 'dev' }[] = [];
  const compat: Record<string, string> = {};
  let section: 'deps' | 'extras' | 'compat' | null = null;
  const entryRe = /^([A-Za-z0-9_]+)\s*=\s*"([^"]*)"\s*$/;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[')) {
      if (line === '[deps]') section = 'deps';
      else if (line === '[extras]') section = 'extras';
      else if (line === '[compat]') section = 'compat';
      else section = null;
      continue;
    }
    const m = line.match(entryRe);
    if (!m) continue;
    if (section === 'deps') entries.push({ name: m[1], group: 'main' });
    else if (section === 'extras') entries.push({ name: m[1], group: 'dev' });
    else if (section === 'compat') compat[m[1]] = m[2];
  }

  return entries.map((e) => ({ name: e.name, group: e.group, spec: compat[e.name] ?? '' }));
}

// Resolved versions from Manifest.toml (the Cargo.lock / uv.lock analog). Handles
// both manifest_format 2.0 (`[[deps.Name]]`) and 1.0 (`[[Name]]`); a `version`
// key in the block gives the installed version (stdlib deps may lack one).
function parseInstalled(dir: string): { name: string; version: string }[] {
  const manifestPath = path.join(dir, 'Manifest.toml');
  if (!fs.existsSync(manifestPath)) return [];
  let text: string;
  try { text = fs.readFileSync(manifestPath, 'utf8'); } catch { return []; }

  const versions = new Map<string, string>();
  let current: string | null = null;
  const headerRe = /^\[\[(?:deps\.)?([A-Za-z0-9_]+)\]\]\s*$/;
  const versionRe = /^version\s*=\s*"([^"]+)"\s*$/;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const header = line.match(headerRe);
    if (header) { current = header[1]; continue; }
    if (line.startsWith('[')) { current = null; continue; }
    if (!current) continue;
    const v = line.match(versionRe);
    if (v && !versions.has(current)) versions.set(current, v[1]);
  }

  return [...versions.entries()]
    .map(([name, version]) => ({ name, version }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const juliaEnv = {
  juliaAvailable(): boolean {
    return juliaProject.juliaAvailable();
  },

  hasProject(dir: string): boolean {
    return fs.existsSync(path.join(dir, 'Project.toml'));
  },

  // Serialises Pkg add/remove for one session (Pkg locks the environment).
  async runExclusive<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    while (inFlight.has(sessionId)) await new Promise((r) => setTimeout(r, 150));
    inFlight.add(sessionId);
    try { return await fn(); } finally { inFlight.delete(sessionId); }
  },

  async listPackages(workingDirRel: string): Promise<{ declared: DeclaredDep[]; installed: { name: string; version: string }[]; lockPresent: boolean }> {
    const dir = resolveSessionCwd(workingDirRel);
    return {
      declared: parseDeclared(dir),
      installed: parseInstalled(dir),
      lockPresent: fs.existsSync(path.join(dir, 'Manifest.toml')),
    };
  },

  // Pkg.add by name (passed via ARGS to dodge -e string quoting). Version
  // constraints are managed through the manifest editor / [compat], not here.
  addPackage(dir: string, name: string): Promise<JuliaResult> {
    return runJulia(
      ['--project=.', '--startup-file=no', '-e', 'using Pkg; Pkg.add(ARGS[1])', '--', name],
      dir,
    );
  },

  removePackage(dir: string, name: string): Promise<JuliaResult> {
    return runJulia(
      ['--project=.', '--startup-file=no', '-e', 'using Pkg; Pkg.rm(ARGS[1])', '--', name],
      dir,
    );
  },

  readManifest(dir: string): { manifest: string } {
    const p = path.join(dir, 'Project.toml');
    return { manifest: fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '' };
  },

  // Write Project.toml, then validate + regenerate Manifest.toml via Pkg.resolve()
  // — surfaces a bad edit as a non-zero exit with stderr (parity with cargo's
  // `cargo metadata` validation / uv sync).
  async writeManifest(dir: string, manifest: string): Promise<JuliaResult> {
    fs.writeFileSync(path.join(dir, 'Project.toml'), manifest);
    return runJulia(['--project=.', '--startup-file=no', '-e', 'using Pkg; Pkg.resolve()'], dir);
  },
};
