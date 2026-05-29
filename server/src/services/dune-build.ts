import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { sampleProcessMemory } from './proc-memory.js';

// Shared cap with cpp-build.ts / execution.ts.
const MAX_OUTPUT_SIZE = 1024 * 1024;

// Dune profiles we surface in the UI. Dune supports user-defined profiles too,
// but those need explicit (env (...)) stanzas; keeping the picker limited to
// the well-known built-ins avoids surprises.
export type DuneProfile = 'dev' | 'release';

export interface DuneFlavor {
  profile: DuneProfile;
}

export interface DuneBuildOptions extends DuneFlavor {
  target?: string;       // path or basename of an executable to focus the build on
  jobs?: number;
  reconfigure?: boolean; // not used by dune (no configure step) — kept for shape parity
}

export interface DuneRunOptions {
  args?: string[];
  stdin?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface DuneDiagnostic {
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'note';
  message: string;
}

export interface DuneBuildResult {
  success: boolean;
  durationMs: number;
  diagnostics: DuneDiagnostic[];
  log: string;
  binaryPaths: string[];
  flavorDir: string;
}

export interface DuneRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  command: string;
  peakRssBytes: number | null;
}

const VALID_PROFILES: ReadonlySet<DuneProfile> = new Set(['dev', 'release']);

// Dune build subdirectory. The dune *profile* (`--profile`) is a compile-flag
// switch; the *context* (named in `dune-workspace`) is what determines the
// subdirectory under `_build/`. The default context is named `default` and
// holds every build regardless of profile, so all our flavor lookups anchor
// here. Users with multi-context workspaces aren't supported in v1.
const BUILD_CONTEXT = 'default';

const ANSI_RE = /\x1B\[[0-9;]*[A-Za-z]/g;

// Match an OCaml/dune diagnostic header. Dune's compiler-output format:
//   File "lib/foo.ml", line 5, characters 4-8:
// or:
//   File "lib/foo.ml", line 5, characters 4-8 (cumulative):
const FILE_HEADER_RE = /^File "([^"]+)", line (\d+), characters (\d+)-\d+/;
// Body line that classifies the diagnostic. Variants seen in practice:
//   Error: ...
//   Error (warning 26 [unused-var]): ...
//   Warning 26 [unused-var]: ...
//   Alert deprecated: ...
const BODY_SEVERITY_RE = /^(Error|Warning|Alert)\b/;

export function isDuneProject(projectDir: string): boolean {
  return fs.existsSync(path.join(projectDir, 'dune-project'));
}

export function flavorDirName(flavor: DuneFlavor): string {
  return flavor.profile;
}

export function validateFlavor(flavor: DuneFlavor): { valid: boolean; error?: string } {
  if (!VALID_PROFILES.has(flavor.profile)) {
    return { valid: false, error: `Invalid dune profile: ${flavor.profile}` };
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
  log: string;
  durationMs: number;
}

function runCmd(cmd: string, args: string[], cwd: string, env?: Record<string, string>): Promise<SpawnCaptureResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    let log = '';
    const proc = spawn(cmd, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: env ? { ...process.env, ...env } : process.env,
    });
    proc.stdout.on('data', (d: Buffer) => {
      if (log.length < MAX_OUTPUT_SIZE) log += d.toString();
    });
    proc.stderr.on('data', (d: Buffer) => {
      if (log.length < MAX_OUTPUT_SIZE) log += d.toString();
    });
    proc.on('close', (code) => {
      resolve({ exitCode: code, log: clamp(stripAnsi(log)), durationMs: Date.now() - start });
    });
    proc.on('error', (err) => {
      resolve({
        exitCode: null,
        log: clamp(stripAnsi(log + `\n[spawn error] ${err.message}`)),
        durationMs: Date.now() - start,
      });
    });
  });
}

// Parse dune-style diagnostics. Dune emits each diagnostic as a multi-line
// block: a `File "...", line N, characters A-B:` header, then a few source
// preview lines, then an `Error:` / `Warning N:` / `Alert ...:` body. The
// body can span several lines until the next blank line or the next File header.
export function parseDiagnostics(output: string, projectDir: string): DuneDiagnostic[] {
  const lines = stripAnsi(output).split('\n');
  const diags: DuneDiagnostic[] = [];
  const MAX_MSG_LEN = 4000;

  let i = 0;
  while (i < lines.length) {
    const header = lines[i].match(FILE_HEADER_RE);
    if (!header) { i++; continue; }
    const [, file, lineStr, colStr] = header;
    let rel: string;
    try {
      rel = path.relative(projectDir, path.resolve(projectDir, file));
      if (rel.startsWith('..') || path.isAbsolute(rel)) rel = file;
    } catch {
      rel = file;
    }
    // Scan forward for the severity line. Skip source preview lines, which
    // look like `5 | let x = ...` or `    ^^^^`. Bail on a blank line or
    // another File header.
    let severity: DuneDiagnostic['severity'] | null = null;
    let messageParts: string[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const ln = lines[j];
      if (!ln.trim()) break;
      if (FILE_HEADER_RE.test(ln)) break;
      const sev = ln.match(BODY_SEVERITY_RE);
      if (sev) {
        severity = sev[1] === 'Error' ? 'error' : sev[1] === 'Warning' ? 'warning' : 'note';
        messageParts.push(ln);
        j++;
        // Continuation lines (indented or non-empty, non-File) belong to this body.
        while (j < lines.length) {
          const cont = lines[j];
          if (!cont.trim()) break;
          if (FILE_HEADER_RE.test(cont)) break;
          messageParts.push(cont);
          j++;
        }
        break;
      }
      j++;
    }
    if (severity) {
      let message = messageParts.join('\n');
      if (message.length > MAX_MSG_LEN) {
        message = message.slice(0, MAX_MSG_LEN) + '\n... [truncated]';
      }
      diags.push({
        file: rel,
        line: parseInt(lineStr, 10),
        column: parseInt(colStr, 10) + 1, // dune uses 0-indexed columns
        severity,
        message,
      });
    }
    i = j > i ? j : i + 1;
  }
  return diags;
}

// Walk a dune build subdir looking for executables. Dune names native
// executables with a `.exe` suffix regardless of OS (Linux/macOS produce
// native ELF/Mach-O binaries; the suffix is purely a dune convention). The
// executable-bit check is a fallback for non-default rules that strip the
// suffix.
function listExecutables(buildDir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(buildDir)) return out;

  // Internal dune bookkeeping dirs to skip — keep the binary list short.
  const SKIP = new Set(['.dune', '.dune-cache', '_doc', '_unused', '.merlin-conf']);
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP.has(ent.name)) continue;
        walk(full);
        continue;
      }
      if (!ent.isFile()) continue;
      const lower = ent.name.toLowerCase();
      // Skip artifacts that aren't runnable.
      if (/\.(cm[ioxat]|cmxa|cmxs|cmti|cmt|cma|a|o|ml|mli|conf|dune|install|opam|ocamlformat|merlin|annot)$/i.test(lower)) continue;
      if (lower.endsWith('.exe')) {
        out.push(full);
        continue;
      }
      try {
        fs.accessSync(full, fs.constants.X_OK);
        const stat = fs.statSync(full);
        if (stat.isFile() && stat.size > 0) out.push(full);
      } catch {
        // not executable
      }
    }
  };
  walk(buildDir);
  return out;
}

export async function duneBuild(
  projectDir: string,
  flavor: DuneFlavor,
  opts?: DuneBuildOptions
): Promise<DuneBuildResult> {
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

  // Always build the whole project (no positional target arg). Dune's
  // "build everything declared" is what users mean when they hit Build,
  // and crucially it produces both .exe and .bc when an executable stanza
  // uses `(modes byte exe)` — passing just `main.exe` would skip bytecode
  // and break debugging. The `opts.target` field is preserved on the API
  // for parity with the CMake side but is intentionally ignored at this
  // layer; it's still used by Run/Debug to pick which produced binary to
  // execute via pickBinary().
  const args: string[] = ['build', '--profile', flavor.profile, '-j', String(opts?.jobs ?? Math.max(1, os.cpus().length))];

  // Force machine-readable output without ANSI colour so parseDiagnostics
  // doesn't have to fight terminal escape codes.
  const result = await runCmd('dune', args, projectDir, {
    OCAML_COLOR: 'never',
    CLICOLOR: '0',
    CLICOLOR_FORCE: '0',
    TERM: 'dumb',
  });

  const diagnostics = parseDiagnostics(result.log, projectDir);
  const success = result.exitCode === 0;
  const buildDir = path.join(projectDir, '_build', BUILD_CONTEXT);
  const binaryPaths = success ? listExecutables(buildDir) : [];

  return {
    success,
    durationMs: result.durationMs,
    diagnostics,
    log: result.log,
    binaryPaths,
    flavorDir: flavorDirName(flavor),
  };
}

// Configure-less. Kept under the same name as cmake's ensureBuilt for
// consistency in the route layer.
export async function ensureBuilt(
  projectDir: string,
  flavor: DuneFlavor,
  opts?: DuneBuildOptions
): Promise<DuneBuildResult> {
  return duneBuild(projectDir, flavor, opts);
}

export async function runBinary(
  binaryPath: string,
  cwd: string,
  opts?: DuneRunOptions
): Promise<DuneRunResult> {
  const timeoutMs = opts?.timeoutMs ?? 30000;
  const args = opts?.args ?? [];

  return new Promise<DuneRunResult>((resolve) => {
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
    // Match by basename (with or without .exe), or by full path suffix.
    const wanted = target.replace(/\.exe$/, '');
    const match = binaryPaths.find((p) => {
      const base = path.basename(p, '.exe');
      return base === wanted || p.endsWith('/' + target) || p === target;
    });
    if (match) return match;
  }
  return binaryPaths[0];
}

export interface DuneTargetEntry {
  name: string;
  path: string;
}

// `flavor` is accepted for API parity with the CMake side but the lookup
// always uses `_build/default/` — dune writes every profile into the same
// context dir (see BUILD_CONTEXT note).
export function listDuneTargets(projectDir: string, _flavor: DuneFlavor): DuneTargetEntry[] {
  const buildDir = path.join(projectDir, '_build', BUILD_CONTEXT);
  return listExecutables(buildDir).map((p) => ({
    name: path.basename(p, '.exe'),
    path: p,
  }));
}

// Returns the set of dune context directories that currently exist under
// `_build/`. Practically this is `['default']` (or empty) for v1.
export function listFlavorBuilds(projectDir: string): string[] {
  const root = path.join(projectDir, '_build');
  if (!fs.existsSync(root)) return [];
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== 'install' && !e.name.startsWith('.'))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

// `flavor` accepted for API parity. Always removes `_build/default/` — see
// BUILD_CONTEXT for why dune doesn't get per-profile build dirs.
export function cleanFlavor(projectDir: string, _flavor: DuneFlavor): boolean {
  const buildDir = path.join(projectDir, '_build', BUILD_CONTEXT);
  if (!fs.existsSync(buildDir)) return false;
  fs.rmSync(buildDir, { recursive: true, force: true });
  return true;
}

export function cleanAll(projectDir: string): boolean {
  const root = path.join(projectDir, '_build');
  if (!fs.existsSync(root)) return false;
  fs.rmSync(root, { recursive: true, force: true });
  return true;
}

// ── Build artifact browser (mirrors cpp-build.ts shapes so the client can
//    reuse the same component) ──

export type DuneArtifactKind =
  | 'dir'
  | 'executable'
  | 'object'      // .cmo / .o
  | 'archive'    // .cma / .cmxa / .a
  | 'shared_lib' // .cmxs / .so / .dylib
  | 'interface'  // .cmi / .cmti
  | 'bytecode'   // .cmo / .cmt
  | 'dune'       // dune / dune-project / dune-package / META / .install
  | 'text'
  | 'binary';

export interface DuneArtifactNode {
  name: string;
  path: string;        // POSIX path relative to <projectDir>/_build
  isDir: boolean;
  size: number;
  kind: DuneArtifactKind;
  childCount?: number;
  children?: DuneArtifactNode[];
}

const ARTIFACT_MAX_ENTRIES = 4000;
const ARTIFACT_TEXT_MAX_BYTES = 512 * 1024;

function classifyArtifact(name: string, isDir: boolean, mode: number): DuneArtifactKind {
  if (isDir) return 'dir';
  const lower = name.toLowerCase();
  if (lower.endsWith('.exe')) return 'executable';
  if (lower.endsWith('.cmi') || lower.endsWith('.cmti')) return 'interface';
  if (lower.endsWith('.cmo') || lower.endsWith('.cmt')) return 'bytecode';
  if (lower.endsWith('.cmx') || lower.endsWith('.o') || lower.endsWith('.obj')) return 'object';
  if (lower.endsWith('.cma') || lower.endsWith('.cmxa') || lower.endsWith('.a') || lower.endsWith('.lib')) return 'archive';
  if (lower.endsWith('.cmxs') || /\.(so|dylib|dll)(\.\d+)*$/i.test(name)) return 'shared_lib';
  if (
    lower === 'dune' ||
    lower === 'dune-project' ||
    lower === 'dune-package' ||
    lower === 'meta' ||
    lower.endsWith('.install') ||
    lower.endsWith('.opam')
  ) return 'dune';
  if (
    lower.endsWith('.ml') || lower.endsWith('.mli') || lower.endsWith('.mll') || lower.endsWith('.mly') ||
    lower.endsWith('.txt') || lower.endsWith('.log') || lower.endsWith('.md') ||
    lower.endsWith('.json') || lower.endsWith('.yaml') || lower.endsWith('.yml')
  ) return 'text';
  if ((mode & 0o111) !== 0) return 'executable';
  return 'binary';
}

export function listArtifactTree(projectDir: string): DuneArtifactNode[] {
  const buildRoot = path.join(projectDir, '_build');
  if (!fs.existsSync(buildRoot)) return [];

  let count = 0;
  const walk = (dir: string, relBase: string): DuneArtifactNode[] => {
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
    const out: DuneArtifactNode[] = [];
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
  const buildRoot = path.resolve(projectDir, '_build');
  const target = path.resolve(buildRoot, ...segments);
  const rel = path.relative(buildRoot, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return target;
}

export interface DuneArtifactFileInfo {
  path: string;
  name: string;
  size: number;
  kind: DuneArtifactKind;
  isDir: boolean;
}

export function statArtifact(projectDir: string, relPath: string): DuneArtifactFileInfo | null {
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

export interface DuneArtifactTextResult {
  content: string;
  truncated: boolean;
  size: number;
  kind: DuneArtifactKind;
}

export function readArtifactText(projectDir: string, relPath: string): DuneArtifactTextResult | null {
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
