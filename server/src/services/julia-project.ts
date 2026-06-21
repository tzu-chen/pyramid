import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../paths.js';

// Shared LanguageServer.jl environment — installed once and reused across every
// Julia session (same spirit as the shared Mathlib cache for Lean). LanguageServer
// must live in its own environment, separate from the user's session project,
// exactly as the VSCode Julia extension does: the session's Project.toml is passed
// to the server as the *workspace* env, not as the env LanguageServer runs in.
const JULIA_LS_ENV_DIR = path.join(DATA_DIR, 'julia-lsp-env');

let juliaAvailableCache: boolean | null = null;
let lsEnvReady = false;
let lsEnvInstalling: Promise<void> | null = null;

function juliaAvailable(): boolean {
  if (juliaAvailableCache !== null) return juliaAvailableCache;
  try {
    const r = spawnSync('julia', ['--version'], { timeout: 5000 });
    juliaAvailableCache = r.status === 0;
  } catch {
    juliaAvailableCache = false;
  }
  return juliaAvailableCache;
}

// LanguageServer is installed if it appears in the LS env's Project.toml [deps].
function lsEnvHasLanguageServer(): boolean {
  const proj = path.join(JULIA_LS_ENV_DIR, 'Project.toml');
  if (!fs.existsSync(proj)) return false;
  try {
    return /(^|\n)\s*LanguageServer\s*=/.test(fs.readFileSync(proj, 'utf8'));
  } catch {
    return false;
  }
}

// One-time `Pkg.add("LanguageServer")` into the shared env. Slow on first run
// (downloads + precompiles); guarded by lsEnvInstalling so concurrent sessions
// share a single install.
function installLanguageServer(): Promise<void> {
  return new Promise((resolve) => {
    try {
      fs.mkdirSync(JULIA_LS_ENV_DIR, { recursive: true });
    } catch { /* fall through; spawn will surface the error */ }
    console.log('[julia-lsp] installing LanguageServer.jl into shared env (first-time setup, may take a few minutes)…');
    const proc = spawn('julia', [
      '--startup-file=no', '--history-file=no',
      `--project=${JULIA_LS_ENV_DIR}`,
      '-e', 'using Pkg; Pkg.add("LanguageServer"); Pkg.precompile()',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    proc.stderr?.on('data', (d: Buffer) => {
      const m = d.toString().trim();
      if (m) console.error(`[julia-lsp:install] ${m}`);
    });
    proc.on('close', (code) => {
      if (code === 0 && lsEnvHasLanguageServer()) {
        lsEnvReady = true;
        console.log('[julia-lsp] LanguageServer.jl ready.');
      } else {
        console.error(`[julia-lsp] LanguageServer.jl install failed (exit ${code}).`);
      }
      resolve();
    });
    proc.on('error', (err) => {
      console.error(`[julia-lsp] install spawn error: ${err.message}`);
      resolve();
    });
  });
}

export const juliaProject = {
  lsEnvDir: JULIA_LS_ENV_DIR,
  juliaAvailable,

  /**
   * Mark a session dir as a Julia (Pkg) environment by ensuring a Project.toml
   * exists. Fast and offline — no julia subprocess needed (an empty/comment-only
   * Project.toml is a valid environment; `Pkg.add` fills in [deps] later).
   * Idempotent — safe on create and on every /ws/julia connect, so sessions
   * created before this feature get promoted on reopen. Mirrors
   * rustProject.ensureCargoProject.
   */
  ensureJuliaProject(projectPath: string): void {
    if (!fs.existsSync(projectPath)) fs.mkdirSync(projectPath, { recursive: true });
    const proj = path.join(projectPath, 'Project.toml');
    if (!fs.existsSync(proj)) {
      fs.writeFileSync(proj, '# Pyramid Julia session environment\n');
    }
  },

  /**
   * Synchronous readiness probe for the shared LanguageServer.jl env (cheap fs
   * check, cached). Kicks off a one-time background install when missing. The
   * /ws/julia handler polls this and asks the client to wait + reconnect until
   * it flips true.
   */
  isLsEnvReady(): boolean {
    if (lsEnvReady) return true;
    if (lsEnvHasLanguageServer()) { lsEnvReady = true; return true; }
    if (!lsEnvInstalling && juliaAvailable()) {
      lsEnvInstalling = installLanguageServer().then(() => { lsEnvInstalling = null; });
    }
    return false;
  },

  lsEnvStatusMessage(): string {
    if (!juliaAvailable()) {
      return 'Julia LSP unavailable: `julia` not found on PATH. Install Julia to enable LanguageServer.jl.';
    }
    return 'Julia LSP: installing LanguageServer.jl (first-time setup, may take a few minutes). Reconnecting…';
  },

  /**
   * CLI args to launch LanguageServer.jl for a session. Runs in the shared LS env
   * (`--project`) so `using LanguageServer` resolves, and points the workspace at
   * the session's project dir (passed as ARGS[1] to dodge -e string quoting).
   */
  lsServerArgs(sessionProjectPath: string): string[] {
    return [
      '--startup-file=no', '--history-file=no',
      `--project=${JULIA_LS_ENV_DIR}`,
      '-e', 'using LanguageServer; run(LanguageServerInstance(stdin, stdout, ARGS[1]))',
      '--', sessionProjectPath,
    ];
  },
};
