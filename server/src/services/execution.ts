import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { sampleProcessMemory } from './proc-memory.js';

const MAX_OUTPUT_SIZE = 1024 * 1024; // 1MB

interface ExecutionOptions {
  timeout_ms?: number;
  stdin?: string;
}

interface ExecutionResult {
  exit_code: number | null;
  stdout: string;
  stderr: string;
  duration_ms: number;
  command: string;
  peak_rss_bytes: number | null;
}

// Escape an arbitrary string for use as a single-quoted POSIX shell argument.
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function getCommand(filename: string, language: string): { cmd: string; args: string[]; shell: boolean } {
  switch (language) {
    case 'python':
      return { cmd: 'python3', args: [filename], shell: false };
    case 'julia':
      return { cmd: 'julia', args: [filename], shell: false };
    case 'cpp': {
      const q = shellQuote(filename);
      // `exec ./a.out` so the shell is replaced by the program (same PID): the
      // kernel resets VmHWM on execve, so /proc RSS sampling then reflects the
      // user's program at runtime rather than the shell or the g++ compile.
      return { cmd: 'sh', args: ['-c', `g++ -O2 -std=c++20 -Wall -Wextra -o a.out ${q} && exec ./a.out`], shell: false };
    }
    case 'ocaml':
      return { cmd: 'ocaml', args: [filename], shell: false };
    case 'rust': {
      const q = shellQuote(filename);
      // Single-file fallback (no Cargo.toml). `exec ./a.out` so the shell is
      // replaced by the program for accurate /proc RSS sampling, same as cpp.
      return { cmd: 'sh', args: ['-c', `rustc -O -o a.out ${q} && exec ./a.out`], shell: false };
    }
    case 'lean':
      return { cmd: 'lake', args: ['env', 'lean', filename], shell: false };
    default:
      return { cmd: 'python3', args: [filename], shell: false };
  }
}

function getCommandString(filename: string, language: string): string {
  switch (language) {
    case 'python': return `python3 ${filename}`;
    case 'julia': return `julia ${filename}`;
    case 'cpp': return `g++ -O2 -std=c++20 -Wall -Wextra -o a.out ${filename} && ./a.out`;
    case 'ocaml': return `ocaml ${filename}`;
    case 'rust': return `rustc -O -o a.out ${filename} && ./a.out`;
    case 'lean': return `lake env lean ${filename}`;
    default: return `python3 ${filename}`;
  }
}

// Resolve the interpreter for a Python session: the per-session uv venv if it
// exists, else system python3. Kept here (rather than importing python-env) so
// execution stays a leaf module; the path contract is the same.
function pythonBin(absWorkingDir: string): string | null {
  const p = path.join(absWorkingDir, '.venv', 'bin', 'python');
  return fs.existsSync(p) ? p : null;
}

export async function executeFile(
  workingDir: string,
  filename: string,
  language: string,
  options: ExecutionOptions = {}
): Promise<ExecutionResult> {
  const timeoutMs = options.timeout_ms || 30000;
  let { cmd, args } = getCommand(filename, language);
  let commandStr = getCommandString(filename, language);

  // Python: prefer the session venv so installs/isolation take effect. Falls
  // back to the system python3 from getCommand when no venv is present.
  if (language === 'python') {
    const venv = pythonBin(path.resolve(workingDir));
    if (venv) {
      cmd = venv;
      args = [filename];
      commandStr = `.venv/bin/python ${filename}`;
    }
  }

  // Julia: activate the session's Pkg environment when a Project.toml exists, so
  // added packages are available. Falls back to bare `julia <file>` otherwise
  // (legacy sessions). Mirrors the Python venv-preference above.
  if (language === 'julia' && fs.existsSync(path.join(path.resolve(workingDir), 'Project.toml'))) {
    args = ['--project=.', filename];
    commandStr = `julia --project=. ${filename}`;
  }

  return new Promise((resolve) => {
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';
    let killed = false;

    const proc = spawn(cmd, args, {
      cwd: path.resolve(workingDir),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const memSampler = sampleProcessMemory(proc.pid);

    if (options.stdin && proc.stdin) {
      proc.stdin.write(options.stdin);
      proc.stdin.end();
    } else if (proc.stdin) {
      proc.stdin.end();
    }

    proc.stdout.on('data', (data: Buffer) => {
      if (stdout.length < MAX_OUTPUT_SIZE) {
        stdout += data.toString();
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      if (stderr.length < MAX_OUTPUT_SIZE) {
        stderr += data.toString();
      }
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
      const peak_rss_bytes = memSampler.stop();
      const duration_ms = Date.now() - startTime;
      resolve({
        exit_code: killed ? null : code,
        stdout: stdout.slice(0, MAX_OUTPUT_SIZE),
        stderr: killed ? stderr.slice(0, MAX_OUTPUT_SIZE) + '\n[Process timed out]' : stderr.slice(0, MAX_OUTPUT_SIZE),
        duration_ms,
        command: commandStr,
        peak_rss_bytes,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      memSampler.stop();
      const duration_ms = Date.now() - startTime;
      resolve({
        exit_code: null,
        stdout: '',
        stderr: err.message,
        duration_ms,
        command: commandStr,
        peak_rss_bytes: null,
      });
    });
  });
}
