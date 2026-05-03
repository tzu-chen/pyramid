import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const MAX_OUTPUT_SIZE = 1024 * 1024; // 1MB cap, matches execution.ts

export type BuildType = 'Debug' | 'Release' | 'RelWithDebInfo' | 'MinSizeRel';
export type Sanitizer = 'asan' | 'tsan' | 'ubsan' | 'msan';

export interface BuildFlavor {
  buildType: BuildType;
  sanitizers?: Sanitizer[];
}

export interface BuildOptions extends BuildFlavor {
  target?: string;
  jobs?: number;
  reconfigure?: boolean;
}

export interface RunOptions {
  args?: string[];
  stdin?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface CompilerDiagnostic {
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'note';
  message: string;
}

export interface ConfigureResult {
  success: boolean;
  durationMs: number;
  buildDir: string;
  compileCommandsPath: string;
  log: string;
}

export interface BuildResult {
  success: boolean;
  durationMs: number;
  diagnostics: CompilerDiagnostic[];
  log: string;
  binaryPaths: string[];
  flavorDir: string;
}

export interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  command: string;
}

const VALID_BUILD_TYPES: ReadonlySet<BuildType> = new Set([
  'Debug', 'Release', 'RelWithDebInfo', 'MinSizeRel',
]);

const VALID_SANITIZERS: ReadonlySet<Sanitizer> = new Set([
  'asan', 'tsan', 'ubsan', 'msan',
]);

const ANSI_RE = /\x1B\[[0-9;]*[A-Za-z]/g;
const DIAG_RE = /^([^\s:][^:]*):(\d+):(\d+):\s+(error|warning|note|fatal error):\s+(.*)$/;

export function isCmakeProject(projectDir: string): boolean {
  return fs.existsSync(path.join(projectDir, 'CMakeLists.txt'));
}

export function flavorDirName(flavor: BuildFlavor): string {
  const parts: string[] = [flavor.buildType];
  if (flavor.sanitizers?.length) {
    parts.push(...[...flavor.sanitizers].sort());
  }
  return parts.join('-');
}

export function validateFlavor(flavor: BuildFlavor): { valid: boolean; error?: string } {
  if (!VALID_BUILD_TYPES.has(flavor.buildType)) {
    return { valid: false, error: `Invalid build type: ${flavor.buildType}` };
  }
  const sans = flavor.sanitizers ?? [];
  for (const s of sans) {
    if (!VALID_SANITIZERS.has(s)) {
      return { valid: false, error: `Invalid sanitizer: ${s}` };
    }
  }
  const unique = new Set(sans);
  if (unique.size !== sans.length) {
    return { valid: false, error: 'Duplicate sanitizers' };
  }
  if (unique.has('tsan') && (unique.has('asan') || unique.has('msan'))) {
    return { valid: false, error: 'tsan cannot be combined with asan or msan' };
  }
  if (unique.has('asan') && unique.has('msan')) {
    return { valid: false, error: 'asan and msan cannot be combined' };
  }
  return { valid: true };
}

function sanitizerFlag(s: Sanitizer): string {
  switch (s) {
    case 'asan':  return '-fsanitize=address -fno-omit-frame-pointer';
    case 'tsan':  return '-fsanitize=thread';
    case 'ubsan': return '-fsanitize=undefined';
    case 'msan':  return '-fsanitize=memory -fno-omit-frame-pointer';
  }
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

function detectGenerator(): string[] {
  // Prefer Ninja when present; cmake will pick Make otherwise.
  const paths = (process.env.PATH || '').split(path.delimiter);
  for (const p of paths) {
    try {
      if (p && fs.existsSync(path.join(p, 'ninja'))) return ['-G', 'Ninja'];
    } catch {
      // fall through
    }
  }
  return [];
}

function updateCompileCommandsSymlink(projectDir: string, buildDir: string): void {
  const target = path.join(buildDir, 'compile_commands.json');
  if (!fs.existsSync(target)) return;
  const link = path.join(projectDir, 'compile_commands.json');
  try {
    const stat = fs.lstatSync(link);
    if (stat.isSymbolicLink() || stat.isFile()) {
      fs.unlinkSync(link);
    }
  } catch {
    // not present
  }
  try {
    fs.symlinkSync(path.relative(projectDir, target), link);
  } catch {
    // Fall back to copy if symlinks aren't supported on this filesystem.
    try { fs.copyFileSync(target, link); } catch { /* give up */ }
  }
}

function isFreshBuildDir(buildDir: string): boolean {
  return fs.existsSync(path.join(buildDir, 'CMakeCache.txt'));
}

export async function cmakeConfigure(
  projectDir: string,
  flavor: BuildFlavor,
  opts?: { reconfigure?: boolean }
): Promise<ConfigureResult> {
  const v = validateFlavor(flavor);
  if (!v.valid) {
    return {
      success: false,
      durationMs: 0,
      buildDir: '',
      compileCommandsPath: '',
      log: `[configure] ${v.error}`,
    };
  }

  const buildDir = path.join(projectDir, 'build', flavorDirName(flavor));
  const compileCommandsPath = path.join(buildDir, 'compile_commands.json');

  if (!opts?.reconfigure && isFreshBuildDir(buildDir) && fs.existsSync(compileCommandsPath)) {
    updateCompileCommandsSymlink(projectDir, buildDir);
    return {
      success: true,
      durationMs: 0,
      buildDir,
      compileCommandsPath,
      log: `[configure] cache hit (${flavorDirName(flavor)})\n`,
    };
  }

  fs.mkdirSync(buildDir, { recursive: true });

  const args: string[] = [
    ...detectGenerator(),
    '-S', projectDir,
    '-B', buildDir,
    `-DCMAKE_BUILD_TYPE=${flavor.buildType}`,
    '-DCMAKE_EXPORT_COMPILE_COMMANDS=ON',
  ];

  if (flavor.sanitizers?.length) {
    const flags = flavor.sanitizers.map(sanitizerFlag).join(' ');
    args.push(`-DCMAKE_CXX_FLAGS=${flags}`);
    args.push(`-DCMAKE_C_FLAGS=${flags}`);
    args.push(`-DCMAKE_EXE_LINKER_FLAGS=${flags}`);
  }

  const result = await runCmd('cmake', args, projectDir, { CLICOLOR_FORCE: '0', CMAKE_COLOR_DIAGNOSTICS: 'OFF' });
  const success = result.exitCode === 0 && fs.existsSync(compileCommandsPath);
  if (success) updateCompileCommandsSymlink(projectDir, buildDir);

  return {
    success,
    durationMs: result.durationMs,
    buildDir,
    compileCommandsPath,
    log: result.log,
  };
}

export function parseDiagnostics(output: string, projectDir: string): CompilerDiagnostic[] {
  const lines = stripAnsi(output).split('\n');
  const diags: CompilerDiagnostic[] = [];
  let current: CompilerDiagnostic | null = null;
  const MAX_MSG_LEN = 4000;

  const push = () => {
    if (current) {
      if (current.message.length > MAX_MSG_LEN) {
        current.message = current.message.slice(0, MAX_MSG_LEN) + '\n... [truncated]';
      }
      diags.push(current);
      current = null;
    }
  };

  for (const line of lines) {
    const m = line.match(DIAG_RE);
    if (m) {
      push();
      const [, file, lineStr, colStr, sev, msg] = m;
      let rel: string;
      try {
        rel = path.relative(projectDir, path.resolve(projectDir, file));
        if (rel.startsWith('..') || path.isAbsolute(rel)) rel = file;
      } catch {
        rel = file;
      }
      current = {
        file: rel,
        line: parseInt(lineStr, 10),
        column: parseInt(colStr, 10),
        severity: sev === 'fatal error' ? 'error' : (sev as CompilerDiagnostic['severity']),
        message: msg,
      };
    } else if (current && line.trim()) {
      current.message += '\n' + line;
    } else if (!line.trim()) {
      push();
    }
  }
  push();
  return diags;
}

function listExecutables(buildDir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(buildDir)) return out;

  const SKIP = new Set(['CMakeFiles', '_deps', 'Testing']);
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
      if (/\.(o|obj|a|so|dylib|dll|cmake|txt|json|ninja|make|d|stamp|log|tlog|pdb|exp|lib)$/i.test(ent.name)) {
        continue;
      }
      try {
        fs.accessSync(full, fs.constants.X_OK);
        out.push(full);
      } catch {
        // not executable
      }
    }
  };
  walk(buildDir);
  return out;
}

export async function cmakeBuild(
  projectDir: string,
  flavor: BuildFlavor,
  opts?: BuildOptions
): Promise<BuildResult> {
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

  const buildDir = path.join(projectDir, 'build', flavorDirName(flavor));
  const args = ['--build', buildDir, '-j', String(opts?.jobs ?? Math.max(1, os.cpus().length))];
  if (opts?.target) args.push('--target', opts.target);

  const result = await runCmd('cmake', args, projectDir, { CLICOLOR_FORCE: '0', CMAKE_COLOR_DIAGNOSTICS: 'OFF' });

  const diagnostics = parseDiagnostics(result.log, projectDir);
  const success = result.exitCode === 0;
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

export async function ensureBuilt(
  projectDir: string,
  flavor: BuildFlavor,
  opts?: BuildOptions
): Promise<BuildResult> {
  const buildDir = path.join(projectDir, 'build', flavorDirName(flavor));
  const compileCommandsPath = path.join(buildDir, 'compile_commands.json');
  const needsConfigure = opts?.reconfigure || !isFreshBuildDir(buildDir) || !fs.existsSync(compileCommandsPath);

  if (needsConfigure) {
    const config = await cmakeConfigure(projectDir, flavor, { reconfigure: opts?.reconfigure });
    if (!config.success) {
      return {
        success: false,
        durationMs: config.durationMs,
        diagnostics: parseDiagnostics(config.log, projectDir),
        log: config.log,
        binaryPaths: [],
        flavorDir: flavorDirName(flavor),
      };
    }
  }
  return cmakeBuild(projectDir, flavor, opts);
}

export async function runBinary(
  binaryPath: string,
  cwd: string,
  opts?: RunOptions
): Promise<RunResult> {
  const timeoutMs = opts?.timeoutMs ?? 30000;
  const args = opts?.args ?? [];

  return new Promise<RunResult>((resolve) => {
    const start = Date.now();
    let stdout = '';
    let stderr = '';
    let killed = false;

    const proc = spawn(binaryPath, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: opts?.env ? { ...process.env, ...opts.env } : process.env,
    });

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
      const command = [binaryPath, ...args].join(' ');
      resolve({
        exitCode: killed ? null : code,
        stdout: clamp(stdout),
        stderr: killed ? clamp(stderr) + '\n[Process timed out]' : clamp(stderr),
        durationMs: Date.now() - start,
        command,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: null,
        stdout: '',
        stderr: err.message,
        durationMs: Date.now() - start,
        command: [binaryPath, ...args].join(' '),
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

export function listFlavorBuilds(projectDir: string): string[] {
  const root = path.join(projectDir, 'build');
  if (!fs.existsSync(root)) return [];
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

export function cleanFlavor(projectDir: string, flavor: BuildFlavor): boolean {
  const buildDir = path.join(projectDir, 'build', flavorDirName(flavor));
  if (!fs.existsSync(buildDir)) return false;
  fs.rmSync(buildDir, { recursive: true, force: true });
  return true;
}

export function cleanAll(projectDir: string): boolean {
  const root = path.join(projectDir, 'build');
  if (!fs.existsSync(root)) return false;
  fs.rmSync(root, { recursive: true, force: true });
  const link = path.join(projectDir, 'compile_commands.json');
  try {
    const stat = fs.lstatSync(link);
    if (stat.isSymbolicLink() || stat.isFile()) fs.unlinkSync(link);
  } catch {
    // not present
  }
  return true;
}

export function listBinaries(projectDir: string, flavor: BuildFlavor): string[] {
  const buildDir = path.join(projectDir, 'build', flavorDirName(flavor));
  return listExecutables(buildDir);
}
