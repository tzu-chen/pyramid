import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import db from '../db.js';

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const LEAN_PROJECTS_DIR = path.join(DATA_DIR, 'lean-projects');
const LEAN_SHARED_DIR = path.join(DATA_DIR, 'lean-shared');
const SHARED_MATHLIB_DIR = path.join(LEAN_SHARED_DIR, 'mathlib');
const DEFAULT_LEAN_VERSION = 'leanprover/lean4:v4.16.0';

function getCstTimestamp(): string {
  const now = new Date();
  const cst = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  return cst.toISOString().replace('Z', '-06:00');
}

function runCommand(cmd: string, args: string[], cwd: string, timeoutMs = 300000): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    const proc = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    proc.stdin.end();

    proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

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

let sharedMathlibReady = false;
let sharedMathlibPromise: Promise<void> | null = null;

async function ensureSharedMathlib(): Promise<void> {
  // Already initialized this server run and sentinel exists
  if (sharedMathlibReady && fs.existsSync(path.join(SHARED_MATHLIB_DIR, '.ready'))) {
    return;
  }

  // If another call is already initializing, wait for it
  if (sharedMathlibPromise) {
    return sharedMathlibPromise;
  }

  // Check if a previous server run already set it up
  if (fs.existsSync(path.join(SHARED_MATHLIB_DIR, '.ready'))) {
    sharedMathlibReady = true;
    return;
  }

  sharedMathlibPromise = (async () => {
    try {
      fs.mkdirSync(SHARED_MATHLIB_DIR, { recursive: true });

      // Write a minimal lakefile.toml for the shared Mathlib project
      const lakefile = `name = "mathlib-shared"

[[require]]
name = "mathlib"
scope = "leanprover-community"
`;
      fs.writeFileSync(path.join(SHARED_MATHLIB_DIR, 'lakefile.toml'), lakefile);
      fs.writeFileSync(path.join(SHARED_MATHLIB_DIR, 'lean-toolchain'), DEFAULT_LEAN_VERSION + '\n');

      // Create a minimal .lean file so Lake is happy
      fs.writeFileSync(path.join(SHARED_MATHLIB_DIR, 'Main.lean'), '');

      // Run lake exe cache get once for the shared project
      console.log('Initializing shared Mathlib cache (this may take a while on first run)...');
      const result = await runCommand('lake', ['exe', 'cache', 'get'], SHARED_MATHLIB_DIR, 600000);

      if (result.exitCode === 0) {
        fs.writeFileSync(path.join(SHARED_MATHLIB_DIR, '.ready'), new Date().toISOString());
        sharedMathlibReady = true;
        console.log('Shared Mathlib cache ready.');
      } else {
        throw new Error(`lake exe cache get failed: ${result.stderr}`);
      }
    } catch (err) {
      sharedMathlibPromise = null;
      throw err;
    }
  })();

  return sharedMathlibPromise;
}

export const leanProject = {
  getProjectPath(sessionId: string): string {
    return path.join(LEAN_PROJECTS_DIR, sessionId);
  },

  async scaffoldProject(sessionId: string): Promise<void> {
    const projectDir = this.getProjectPath(sessionId);
    fs.mkdirSync(projectDir, { recursive: true });

    // Ensure shared Mathlib is available
    await ensureSharedMathlib();

    // Compute relative path from session project to shared Mathlib
    const relMathlibPath = path.relative(projectDir, SHARED_MATHLIB_DIR);

    // Write lakefile.toml referencing shared Mathlib via local path
    const lakefile = `name = "pyramid-session"
leanOptions = [{ name = "autoImplicit", value = false }]

[[require]]
name = "mathlib"
path = "${relMathlibPath}"
`;
    fs.writeFileSync(path.join(projectDir, 'lakefile.toml'), lakefile);

    // Write lean-toolchain
    fs.writeFileSync(path.join(projectDir, 'lean-toolchain'), DEFAULT_LEAN_VERSION + '\n');

    // Create Main.lean with starter import
    const mainLean = `import Mathlib

`;
    fs.writeFileSync(path.join(projectDir, 'Main.lean'), mainLean);

    // Update lake_status to initializing
    const now = getCstTimestamp();
    db.prepare('UPDATE lean_session_meta SET lake_status = ?, updated_at = ? WHERE session_id = ?')
      .run('initializing', now, sessionId);

    // Run lake update to resolve dependencies from shared Mathlib
    try {
      const result = await runCommand('lake', ['update'], projectDir);
      const status = result.exitCode === 0 ? 'ready' : 'error';
      const updateNow = getCstTimestamp();
      db.prepare('UPDATE lean_session_meta SET lake_status = ?, last_build_output = ?, updated_at = ? WHERE session_id = ?')
        .run(status, (result.stdout + '\n' + result.stderr).trim(), updateNow, sessionId);
    } catch (err) {
      const updateNow = getCstTimestamp();
      db.prepare('UPDATE lean_session_meta SET lake_status = ?, last_build_output = ?, updated_at = ? WHERE session_id = ?')
        .run('error', (err as Error).message, updateNow, sessionId);
    }
  },

  deleteProject(sessionId: string): void {
    const projectDir = this.getProjectPath(sessionId);
    if (fs.existsSync(projectDir)) {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  },

  async build(sessionId: string): Promise<{ build_output: string; lake_status: string }> {
    const projectDir = this.getProjectPath(sessionId);
    const now = getCstTimestamp();

    // Set status to building
    db.prepare('UPDATE lean_session_meta SET lake_status = ?, updated_at = ? WHERE session_id = ?')
      .run('building', now, sessionId);

    const result = await runCommand('lake', ['build'], projectDir);
    const output = (result.stdout + '\n' + result.stderr).trim();
    const status = result.exitCode === 0 ? 'ready' : 'error';
    const buildNow = getCstTimestamp();

    db.prepare('UPDATE lean_session_meta SET lake_status = ?, last_build_output = ?, last_build_at = ?, updated_at = ? WHERE session_id = ?')
      .run(status, output, buildNow, buildNow, sessionId);

    return { build_output: output, lake_status: status };
  },
};
