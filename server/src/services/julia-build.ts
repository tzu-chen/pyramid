import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

// Julia "build" pipeline — the interpreted analog of cargo build/test. There is
// no compile artifact (precompiled caches live in the global depot), so this is
// about precompiling the environment and running tests, with Julia stacktraces
// parsed into editor diagnostics. Results feed the shared builds/build_diagnostics
// tables and the BuildPanel, exactly like cpp/dune/cargo.

export type JuliaBuildMode = 'precompile' | 'test';

export interface JuliaDiagnostic {
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'note';
  message: string;
}

export interface JuliaBuildResult {
  success: boolean;
  durationMs: number;
  diagnostics: JuliaDiagnostic[];
  log: string;
  binaryPaths: string[]; // always [] — Julia produces no session-local binary
}

const MAX_LOG = 1024 * 1024;
const MAX_DIAGS = 200;

export function isJuliaProject(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'Project.toml'));
}

interface RawRun { stdout: string; stderr: string; exitCode: number | null; durationMs: number }

function runJulia(args: string[], cwd: string, timeoutMs = 300000): Promise<RawRun> {
  return new Promise((resolve) => {
    const start = Date.now();
    let stdout = '';
    let stderr = '';
    const proc = spawn('julia', args, {
      cwd,
      env: { ...process.env, JULIA_PKG_USE_CLI_GIT: 'false' },
    });
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* dead */ } }, timeoutMs);
    proc.stdout.on('data', (d: Buffer) => { if (stdout.length < MAX_LOG) stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { if (stderr.length < MAX_LOG) stderr += d.toString(); });
    proc.on('close', (code) => { clearTimeout(timer); resolve({ stdout, stderr, exitCode: code, durationMs: Date.now() - start }); });
    proc.on('error', (err) => { clearTimeout(timer); resolve({ stdout, stderr: stderr + err.message, exitCode: null, durationMs: Date.now() - start }); });
  });
}

// Resolve a path Julia printed into a session-relative path, or null when it
// points outside the session (Base/stdlib/deps) — we only surface diagnostics
// for the user's own files. Julia prints stdlib frames as `./Base.jl` etc., so a
// path being relative isn't enough; we require the resolved file to actually
// exist inside the session dir. Mirrors the relative-path normalization cpp/dune do.
function toSessionRelative(file: string, dir: string): string | null {
  const abs = path.isAbsolute(file)
    ? path.normalize(file)
    : path.normalize(path.join(dir, file.replace(/^\.\//, '')));
  const rel = path.relative(dir, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel) || !rel) return null;
  if (!fs.existsSync(abs)) return null;
  return rel;
}

// Parse Julia error/stacktrace text into diagnostics. Julia emits no structured
// (JSON) diagnostics like cargo, so this is regex-based like the cpp/dune parsers:
//  - `ERROR: [LoadError: ]<msg>` gives the primary message
//  - `in expression starting at <file>:<line>` and stack frames `@ … <file>:<line>`
//    give locations
//  - `Test Failed at <file>:<line>` (with the following `Expression:` line)
//  - logging warnings (`┌ Warning: …` paired with `└ @ … <file>:<line>`)
export function parseJuliaDiagnostics(output: string, dir: string): JuliaDiagnostic[] {
  const lines = output.split('\n');
  const diags: JuliaDiagnostic[] = [];
  const seen = new Set<string>();

  const push = (file: string, line: number, severity: JuliaDiagnostic['severity'], message: string) => {
    const rel = toSessionRelative(file, dir);
    if (!rel) return;
    const key = `${rel}:${line}:${severity}:${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (diags.length < MAX_DIAGS) {
      diags.push({ file: rel, line, column: 1, severity, message: message.trim() || 'error' });
    }
  };

  let mainMsg = '';
  for (const l of lines) {
    const e = l.match(/^\s*ERROR:\s*(?:LoadError:\s*)*(.+)$/);
    if (e) { mainMsg = e[1].trim(); break; }
  }

  // Primary location: "in expression starting at <file>:<line>"
  for (const l of lines) {
    const m = l.match(/in expression starting at (.+?):(\d+)/);
    if (m) push(m[1], parseInt(m[2], 10), 'error', mainMsg || 'error');
  }

  // Stacktrace frames: `@ <Module> <file>:<line>` — the session-local ones
  // pinpoint the failing line (deeper than "in expression starting at"). Base /
  // stdlib frames resolve outside the session and are filtered by push().
  if (mainMsg) {
    for (const l of lines) {
      if (l.includes('┌') || l.includes('└')) continue; // logging frames handled below
      const m = l.match(/@\s+\S+\s+(\S+\.jl):(\d+)/);
      if (m) push(m[1], parseInt(m[2], 10), 'error', mainMsg);
    }
  }

  // Test failures: "Test Failed at <file>:<line>" / "Error During Test at …"
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/(?:Test Failed|Error During Test) at (.+?):(\d+)/);
    if (!m) continue;
    let msg = 'Test failed';
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const ex = lines[j].match(/Expression:\s*(.+)/);
      if (ex) { msg = `Test failed: ${ex[1].trim()}`; break; }
    }
    push(m[1], parseInt(m[2], 10), 'error', msg);
  }

  // Logging warnings: ┌ Warning: <msg> … └ @ <Module> <file>:<line>
  for (let i = 0; i < lines.length; i++) {
    const w = lines[i].match(/┌ Warning:\s*(.+)/);
    if (!w) continue;
    for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
      const at = lines[j].match(/└ @ .*?\s(\S+):(\d+)/);
      if (at) { push(at[1], parseInt(at[2], 10), 'warning', w[1]); break; }
    }
  }

  return diags;
}

function clampLog(s: string): string {
  return s.length > MAX_LOG ? s.slice(0, MAX_LOG) + '\n…(truncated)' : s;
}

export async function juliaPrecompile(dir: string): Promise<JuliaBuildResult> {
  const r = await runJulia(
    ['--project=.', '--startup-file=no', '-e', 'using Pkg; Pkg.precompile()'],
    dir,
  );
  const log = clampLog(`$ julia --project=. -e 'using Pkg; Pkg.precompile()'\n\n${r.stdout}${r.stderr}`);
  return {
    success: r.exitCode === 0,
    durationMs: r.durationMs,
    diagnostics: r.exitCode === 0 ? [] : parseJuliaDiagnostics(r.stdout + r.stderr, dir),
    log,
    binaryPaths: [],
  };
}

export async function juliaTest(dir: string): Promise<JuliaBuildResult> {
  const runtests = path.join(dir, 'test', 'runtests.jl');
  let args: string[];
  let cmdLabel: string;

  if (fs.existsSync(runtests)) {
    // Script-style sessions: run the test file directly under the project env.
    // Avoids Pkg.test()'s requirement that the active project be a named package.
    args = ['--project=.', '--startup-file=no', path.join('test', 'runtests.jl')];
    cmdLabel = 'julia --project=. test/runtests.jl';
  } else {
    // Proper package: let Pkg drive the test target in an isolated subprocess.
    args = ['--project=.', '--startup-file=no', '-e', 'using Pkg; Pkg.test()'];
    cmdLabel = "julia --project=. -e 'using Pkg; Pkg.test()'";
  }

  const r = await runJulia(args, dir);
  const log = clampLog(`$ ${cmdLabel}\n\n${r.stdout}${r.stderr}`);
  return {
    success: r.exitCode === 0,
    durationMs: r.durationMs,
    diagnostics: r.exitCode === 0 ? [] : parseJuliaDiagnostics(r.stdout + r.stderr, dir),
    log,
    binaryPaths: [],
  };
}

export function runJuliaBuild(dir: string, mode: JuliaBuildMode): Promise<JuliaBuildResult> {
  return mode === 'test' ? juliaTest(dir) : juliaPrecompile(dir);
}
