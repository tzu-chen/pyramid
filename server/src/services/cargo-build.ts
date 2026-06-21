import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { sampleProcessMemory } from './proc-memory.js';

// Shared cap with cpp-build.ts / dune-build.ts / execution.ts.
const MAX_OUTPUT_SIZE = 1024 * 1024;

// Cargo's two built-in profiles we surface. `dev` and `release` are the
// well-known ones; custom `[profile.*]` entries in Cargo.toml still work for a
// `cargo build` but aren't offered in the picker (v1).
export type CargoProfile = 'dev' | 'release';

export interface CargoFlavor {
  profile: CargoProfile;
  features?: string[];
  allFeatures?: boolean;
  noDefaultFeatures?: boolean;
}

export interface CargoBuildOptions extends CargoFlavor {
  target?: string;       // bin name to run/pick (build always builds everything)
  jobs?: number;
  reconfigure?: boolean; // not used by cargo (no configure step) — kept for shape parity
}

export interface CargoRunOptions {
  args?: string[];
  stdin?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface CargoDiagnostic {
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'note';
  message: string;
  code?: string | null; // rustc error code (E0382) or lint name (clippy::needless_return)
}

export interface CargoBuildResult {
  success: boolean;
  durationMs: number;
  diagnostics: CargoDiagnostic[];
  log: string;
  binaryPaths: string[];
  flavorDir: string;
}

export interface CargoRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  command: string;
  peakRssBytes: number | null;
}

const VALID_PROFILES: ReadonlySet<CargoProfile> = new Set(['dev', 'release']);

// Cargo writes the `dev` profile into `target/debug` and `release` into
// `target/release` — the dir name does not match the profile name for `dev`.
// (Same spirit as dune-build.ts's BUILD_CONTEXT note: the on-disk dir is a
// fixed cargo convention, not the flag we pass.)
function profileDirName(profile: CargoProfile): string {
  return profile === 'release' ? 'release' : 'debug';
}

const ANSI_RE = /\x1B\[[0-9;]*[A-Za-z]/g;

// A feature / package token that's safe to splice onto a cargo command line.
// crate features are `[A-Za-z0-9_-]`; reject anything that could read as a flag
// or shell metacharacter (the server is reachable over the LAN, CORS *).
const FEATURE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function isCargoProject(projectDir: string): boolean {
  return fs.existsSync(path.join(projectDir, 'Cargo.toml'));
}

export function flavorDirName(flavor: CargoFlavor): string {
  return profileDirName(flavor.profile);
}

export function validateFlavor(flavor: CargoFlavor): { valid: boolean; error?: string } {
  if (!VALID_PROFILES.has(flavor.profile)) {
    return { valid: false, error: `Invalid cargo profile: ${flavor.profile}` };
  }
  for (const f of flavor.features ?? []) {
    if (!FEATURE_RE.test(f)) {
      return { valid: false, error: `Invalid feature name: ${f}` };
    }
  }
  return { valid: true };
}

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

function clamp(s: string): string {
  return s.length > MAX_OUTPUT_SIZE ? s.slice(0, MAX_OUTPUT_SIZE) : s;
}

interface SpawnCaptureResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

// Unlike cpp/dune's merged runCmd, cargo's structured diagnostics arrive on
// stdout (JSON lines) while cargo's own human progress ("Compiling …",
// "Finished", "error: could not compile …") arrives on stderr, so we keep the
// two streams separate.
function runCmd(cmd: string, args: string[], cwd: string, env?: Record<string, string>): Promise<SpawnCaptureResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    let stdout = '';
    let stderr = '';
    const proc = spawn(cmd, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: env ? { ...process.env, ...env } : process.env,
    });
    proc.stdout.on('data', (d: Buffer) => {
      if (stdout.length < MAX_OUTPUT_SIZE) stdout += d.toString();
    });
    proc.stderr.on('data', (d: Buffer) => {
      if (stderr.length < MAX_OUTPUT_SIZE) stderr += d.toString();
    });
    proc.on('close', (code) => {
      resolve({ exitCode: code, stdout, stderr, durationMs: Date.now() - start });
    });
    proc.on('error', (err) => {
      resolve({
        exitCode: null,
        stdout,
        stderr: stderr + `\n[spawn error] ${err.message}`,
        durationMs: Date.now() - start,
      });
    });
  });
}

interface RustcSpan {
  file_name?: string;
  line_start?: number;
  column_start?: number;
  is_primary?: boolean;
}
interface RustcMessage {
  rendered?: string;
  level?: string;
  code?: { code?: string } | null;
  spans?: RustcSpan[];
}
interface CargoJsonLine {
  reason?: string;
  message?: RustcMessage;
}

function levelToSeverity(level: string | undefined): CargoDiagnostic['severity'] | null {
  switch (level) {
    case 'error':
    case 'error: internal compiler error':
      return 'error';
    case 'warning':
      return 'warning';
    case 'note':
    case 'help':
    case 'failure-note':
      return 'note';
    default:
      return null;
  }
}

// Parse `cargo … --message-format=json` output. Each stdout line is a JSON
// object; we keep the ones whose `reason` is `compiler-message` and map rustc's
// diagnostic to our flat shape. The primary span supplies file/line/col, and
// rustc's own `rendered` text (with its caret diagrams) is kept verbatim as the
// message — far richer and more robust than regex-scraping a text log.
//
// Returns both the structured diagnostics and a reconstructed human log built
// from the rendered blocks (since the raw stdout is JSON, not human-readable).
export function parseCargoJson(stdout: string, projectDir: string): { diagnostics: CargoDiagnostic[]; rendered: string } {
  const diags: CargoDiagnostic[] = [];
  const renderedParts: string[] = [];
  const MAX_MSG_LEN = 4000;

  for (const raw of stdout.split('\n')) {
    const line = raw.trim();
    if (!line || line[0] !== '{') continue;
    let obj: CargoJsonLine;
    try {
      obj = JSON.parse(line) as CargoJsonLine;
    } catch {
      continue;
    }
    if (obj.reason !== 'compiler-message' || !obj.message) continue;
    const m = obj.message;
    const severity = levelToSeverity(m.level);
    if (!severity) continue;

    if (m.rendered) renderedParts.push(stripAnsi(m.rendered).replace(/\s+$/, ''));

    const span = m.spans?.find((s) => s.is_primary) ?? m.spans?.[0];
    if (!span || !span.file_name) continue; // crate-level summaries have no span — skip the inline diag

    let rel: string;
    try {
      rel = path.relative(projectDir, path.resolve(projectDir, span.file_name));
      if (rel.startsWith('..') || path.isAbsolute(rel)) rel = span.file_name;
    } catch {
      rel = span.file_name;
    }

    let message = stripAnsi(m.rendered ?? m.code?.code ?? severity);
    if (message.length > MAX_MSG_LEN) {
      message = message.slice(0, MAX_MSG_LEN) + '\n... [truncated]';
    }

    diags.push({
      file: rel,
      line: span.line_start ?? 1,
      column: span.column_start ?? 1,
      severity,
      message,
      code: m.code?.code ?? null,
    });
  }

  return { diagnostics: diags, rendered: renderedParts.join('\n') };
}

// Build the human-readable build log shown in the Build panel: cargo's own
// progress/status lines (stderr) followed by the rendered rustc diagnostics
// reconstructed from the JSON stdout.
function buildLog(stderr: string, rendered: string): string {
  const parts = [stripAnsi(stderr).replace(/\s+$/, '')];
  if (rendered) parts.push(rendered);
  return clamp(parts.filter(Boolean).join('\n'));
}

// Walk the top level of `target/<dir>/` for runnable executables. Cargo places
// the final binaries directly under the profile dir; hashed copies, build
// scripts, and incremental state live in subdirs we skip.
function listExecutables(buildDir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(buildDir)) return out;

  const SKIP_EXT = /\.(d|rlib|rmeta|so|dylib|dll|a|json|timestamp|o)$/i;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(buildDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    if (!ent.isFile()) continue; // skip deps/ build/ examples/ incremental/ .fingerprint/
    if (SKIP_EXT.test(ent.name)) continue;
    const full = path.join(buildDir, ent.name);
    try {
      fs.accessSync(full, fs.constants.X_OK);
      const stat = fs.statSync(full);
      if (stat.isFile() && stat.size > 0) out.push(full);
    } catch {
      // not executable
    }
  }
  return out;
}

function cargoFlavorArgs(flavor: CargoFlavor): string[] {
  const args: string[] = [];
  if (flavor.profile === 'release') args.push('--release');
  if (flavor.allFeatures) {
    args.push('--all-features');
  } else if (flavor.features?.length) {
    args.push('--features', flavor.features.join(','));
  }
  if (flavor.noDefaultFeatures) args.push('--no-default-features');
  return args;
}

export async function cargoBuild(
  projectDir: string,
  flavor: CargoFlavor,
  _opts?: CargoBuildOptions
): Promise<CargoBuildResult> {
  const v = validateFlavor(flavor);
  if (!v.valid) {
    return {
      success: false,
      durationMs: 0,
      diagnostics: [],
      log: `[build] ${v.error}`,
      binaryPaths: [],
      flavorDir: flavorDirName(flavor),
    };
  }

  // Build everything (no --bin): a bare Build means "compile the whole package",
  // and `opts.target` is only used downstream by pickBinary to choose which
  // produced binary to run — mirrors the dune-build.ts approach.
  const args = ['build', '--message-format=json', ...cargoFlavorArgs(flavor)];

  const result = await runCmd('cargo', args, projectDir, {
    CARGO_TERM_COLOR: 'never',
    // Keep cargo quiet about its own progress bar noise; diagnostics still flow.
    CARGO_TERM_PROGRESS_WHEN: 'never',
  });

  const { diagnostics, rendered } = parseCargoJson(result.stdout, projectDir);
  const success = result.exitCode === 0;
  const buildDir = path.join(projectDir, 'target', profileDirName(flavor.profile));
  const binaryPaths = success ? listExecutables(buildDir) : [];

  return {
    success,
    durationMs: result.durationMs,
    diagnostics,
    log: buildLog(result.stderr, rendered),
    binaryPaths,
    flavorDir: flavorDirName(flavor),
  };
}

// Configure-less. Kept under the same name as cmake/dune's ensureBuilt for
// consistency in the route layer.
export async function ensureBuilt(
  projectDir: string,
  flavor: CargoFlavor,
  opts?: CargoBuildOptions
): Promise<CargoBuildResult> {
  return cargoBuild(projectDir, flavor, opts);
}

// `cargo clippy --message-format=json`: same JSON shape as build, so clippy
// lints flow through the identical parser (they arrive as compiler-messages
// with `code.code` like `clippy::needless_return`).
export async function cargoClippy(
  projectDir: string,
  flavor: CargoFlavor
): Promise<CargoBuildResult> {
  const v = validateFlavor(flavor);
  if (!v.valid) {
    return {
      success: false, durationMs: 0, diagnostics: [],
      log: `[clippy] ${v.error}`, binaryPaths: [], flavorDir: flavorDirName(flavor),
    };
  }
  const args = ['clippy', '--message-format=json', ...cargoFlavorArgs(flavor)];
  const result = await runCmd('cargo', args, projectDir, { CARGO_TERM_COLOR: 'never' });
  const { diagnostics, rendered } = parseCargoJson(result.stdout, projectDir);
  return {
    success: result.exitCode === 0,
    durationMs: result.durationMs,
    diagnostics,
    log: buildLog(result.stderr, rendered),
    binaryPaths: [],
    flavorDir: flavorDirName(flavor),
  };
}

// `cargo test`: run in plain (non-JSON) mode and capture human output. The test
// harness report ("running N tests … ok") is what the user wants to see, and a
// compile failure surfaces in the same stream — no structured diagnostics
// needed for the Test action.
export async function cargoTest(
  projectDir: string,
  flavor: CargoFlavor,
  opts?: { timeoutMs?: number }
): Promise<CargoRunResult> {
  const timeoutMs = opts?.timeoutMs ?? 120000;
  const args = ['test', ...cargoFlavorArgs(flavor)];

  return new Promise<CargoRunResult>((resolve) => {
    const start = Date.now();
    let stdout = '';
    let stderr = '';
    let killed = false;
    const proc = spawn('cargo', args, {
      cwd: projectDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CARGO_TERM_COLOR: 'never' },
    });
    proc.stdout.on('data', (d: Buffer) => { if (stdout.length < MAX_OUTPUT_SIZE) stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { if (stderr.length < MAX_OUTPUT_SIZE) stderr += d.toString(); });
    const timer = setTimeout(() => {
      killed = true;
      proc.kill('SIGTERM');
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* dead */ } }, 2000);
    }, timeoutMs);
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: killed ? null : code,
        stdout: clamp(stripAnsi(stdout)),
        stderr: killed ? clamp(stripAnsi(stderr)) + '\n[Process timed out]' : clamp(stripAnsi(stderr)),
        durationMs: Date.now() - start,
        command: ['cargo', ...args].join(' '),
        peakRssBytes: null,
      });
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: null, stdout: '', stderr: err.message,
        durationMs: Date.now() - start, command: ['cargo', ...args].join(' '), peakRssBytes: null,
      });
    });
  });
}

export async function runBinary(
  binaryPath: string,
  cwd: string,
  opts?: CargoRunOptions
): Promise<CargoRunResult> {
  const timeoutMs = opts?.timeoutMs ?? 30000;
  const args = opts?.args ?? [];

  return new Promise<CargoRunResult>((resolve) => {
    const start = Date.now();
    let stdout = '';
    let stderr = '';
    let killed = false;

    const proc = spawn(binaryPath, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: opts?.env ? { ...process.env, ...opts.env } : process.env,
    });

    const memSampler = sampleProcessMemory(proc.pid);

    if (opts?.stdin && proc.stdin) {
      proc.stdin.write(opts.stdin);
      proc.stdin.end();
    } else if (proc.stdin) {
      proc.stdin.end();
    }

    proc.stdout.on('data', (d: Buffer) => {
      if (stdout.length < MAX_OUTPUT_SIZE) stdout += d.toString();
    });
    proc.stderr.on('data', (d: Buffer) => {
      if (stderr.length < MAX_OUTPUT_SIZE) stderr += d.toString();
    });

    const timer = setTimeout(() => {
      killed = true;
      proc.kill('SIGTERM');
      setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { /* already dead */ }
      }, 2000);
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      const peakRssBytes = memSampler.stop();
      const command = [binaryPath, ...args].join(' ');
      resolve({
        exitCode: killed ? null : code,
        stdout: clamp(stdout),
        stderr: killed ? clamp(stderr) + '\n[Process timed out]' : clamp(stderr),
        durationMs: Date.now() - start,
        command,
        peakRssBytes,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      memSampler.stop();
      resolve({
        exitCode: null,
        stdout: '',
        stderr: err.message,
        durationMs: Date.now() - start,
        command: [binaryPath, ...args].join(' '),
        peakRssBytes: null,
      });
    });
  });
}

export function pickBinary(binaryPaths: string[], target?: string): string | null {
  if (!binaryPaths.length) return null;
  if (target) {
    const match = binaryPaths.find((p) => path.basename(p) === target);
    if (match) return match;
  }
  return binaryPaths[0];
}

export interface CargoTargetEntry {
  name: string;
  path: string;
}

// `flavor` selects the profile dir to scan. Mirrors dune/cmake listTargets:
// returns the executables present after a build (the picker fills in lazily).
export function listCargoTargets(projectDir: string, flavor: CargoFlavor): CargoTargetEntry[] {
  const buildDir = path.join(projectDir, 'target', profileDirName(flavor.profile));
  return listExecutables(buildDir).map((p) => ({ name: path.basename(p), path: p }));
}

export function listFlavorBuilds(projectDir: string): string[] {
  const root = path.join(projectDir, 'target');
  if (!fs.existsSync(root)) return [];
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && (e.name === 'debug' || e.name === 'release'))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

export function cleanFlavor(projectDir: string, flavor: CargoFlavor): boolean {
  const buildDir = path.join(projectDir, 'target', profileDirName(flavor.profile));
  if (!fs.existsSync(buildDir)) return false;
  fs.rmSync(buildDir, { recursive: true, force: true });
  return true;
}

export function cleanAll(projectDir: string): boolean {
  const root = path.join(projectDir, 'target');
  if (!fs.existsSync(root)) return false;
  fs.rmSync(root, { recursive: true, force: true });
  return true;
}

// ── Build artifact browser (mirrors cpp-build.ts / dune-build.ts shapes so the
//    client reuses the same ArtifactBrowser component) ──

export type CargoArtifactKind =
  | 'dir'
  | 'executable'
  | 'archive'    // .rlib / .a
  | 'rmeta'      // .rmeta (crate metadata)
  | 'shared_lib' // .so / .dylib / .dll
  | 'object'     // .o
  | 'depfile'    // .d
  | 'text'
  | 'binary';

export interface CargoArtifactNode {
  name: string;
  path: string;        // POSIX path relative to <projectDir>/target
  isDir: boolean;
  size: number;
  kind: CargoArtifactKind;
  childCount?: number;
  children?: CargoArtifactNode[];
}

const ARTIFACT_MAX_ENTRIES = 4000;
const ARTIFACT_TEXT_MAX_BYTES = 512 * 1024;

function classifyArtifact(name: string, isDir: boolean, mode: number): CargoArtifactKind {
  if (isDir) return 'dir';
  const lower = name.toLowerCase();
  if (lower.endsWith('.rlib') || lower.endsWith('.a')) return 'archive';
  if (lower.endsWith('.rmeta')) return 'rmeta';
  if (lower.endsWith('.o') || lower.endsWith('.obj')) return 'object';
  if (/\.(so|dylib|dll)(\.\d+)*$/i.test(name)) return 'shared_lib';
  if (lower.endsWith('.d')) return 'depfile';
  if (
    lower.endsWith('.json') || lower.endsWith('.txt') || lower.endsWith('.log') ||
    lower.endsWith('.toml') || lower.endsWith('.lock') || lower.endsWith('.timestamp') ||
    lower === '.cargo-lock' || lower === 'cachedir.tag'
  ) return 'text';
  if ((mode & 0o111) !== 0) return 'executable';
  return 'binary';
}

export function listArtifactTree(projectDir: string): CargoArtifactNode[] {
  const buildRoot = path.join(projectDir, 'target');
  if (!fs.existsSync(buildRoot)) return [];

  let count = 0;
  const walk = (dir: string, relBase: string): CargoArtifactNode[] => {
    if (count >= ARTIFACT_MAX_ENTRIES) return [];
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    const out: CargoArtifactNode[] = [];
    for (const ent of entries) {
      if (count >= ARTIFACT_MAX_ENTRIES) break;
      if (ent.name.startsWith('.')) continue;
      const full = path.join(dir, ent.name);
      const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
      let stat: fs.Stats;
      try { stat = fs.lstatSync(full); } catch { continue; }
      if (stat.isSymbolicLink()) continue;
      const isDir = stat.isDirectory();
      const kind = classifyArtifact(ent.name, isDir, stat.mode);
      count++;
      if (isDir) {
        const children = walk(full, rel);
        out.push({ name: ent.name, path: rel, isDir: true, size: 0, kind, childCount: children.length, children });
      } else if (stat.isFile()) {
        out.push({ name: ent.name, path: rel, isDir: false, size: stat.size, kind });
      }
    }
    return out;
  };
  return walk(buildRoot, '');
}

export function resolveArtifactPath(projectDir: string, relPath: string): string | null {
  if (typeof relPath !== 'string') return null;
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.includes('\0')) return null;
  const segments = normalized.split('/').filter(Boolean);
  if (segments.some((s) => s === '..' || s === '.')) return null;
  if (segments.length > 32) return null;
  const buildRoot = path.resolve(projectDir, 'target');
  const target = path.resolve(buildRoot, ...segments);
  const rel = path.relative(buildRoot, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return target;
}

export interface CargoArtifactFileInfo {
  path: string;
  name: string;
  size: number;
  kind: CargoArtifactKind;
  isDir: boolean;
}

export function statArtifact(projectDir: string, relPath: string): CargoArtifactFileInfo | null {
  const abs = resolveArtifactPath(projectDir, relPath);
  if (!abs || !fs.existsSync(abs)) return null;
  let stat: fs.Stats;
  try { stat = fs.lstatSync(abs); } catch { return null; }
  if (stat.isSymbolicLink()) return null;
  const name = path.basename(abs);
  return {
    path: relPath.replace(/\\/g, '/').replace(/^\/+/, ''),
    name,
    size: stat.isFile() ? stat.size : 0,
    kind: classifyArtifact(name, stat.isDirectory(), stat.mode),
    isDir: stat.isDirectory(),
  };
}

export interface CargoArtifactTextResult {
  content: string;
  truncated: boolean;
  size: number;
  kind: CargoArtifactKind;
}

export function readArtifactText(projectDir: string, relPath: string): CargoArtifactTextResult | null {
  const info = statArtifact(projectDir, relPath);
  if (!info || info.isDir) return null;
  const abs = resolveArtifactPath(projectDir, relPath);
  if (!abs) return null;
  const fd = fs.openSync(abs, 'r');
  try {
    const buf = Buffer.alloc(Math.min(info.size, ARTIFACT_TEXT_MAX_BYTES));
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
    const slice = buf.subarray(0, bytesRead);
    return {
      content: slice.toString('utf8'),
      truncated: info.size > bytesRead,
      size: info.size,
      kind: info.kind,
    };
  } finally {
    fs.closeSync(fd);
  }
}

// Exported for the run jobs default (cargo builds can be slow on first compile).
export const DEFAULT_BUILD_JOBS = Math.max(1, os.cpus().length);
