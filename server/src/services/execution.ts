import { spawn } from 'child_process';
import path from 'path';

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
      return { cmd: 'sh', args: ['-c', `g++ -O2 -std=c++20 -Wall -Wextra -o a.out ${q} && ./a.out`], shell: false };
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
    case 'lean': return `lake env lean ${filename}`;
    default: return `python3 ${filename}`;
  }
}

export async function executeFile(
  workingDir: string,
  filename: string,
  language: string,
  options: ExecutionOptions = {}
): Promise<ExecutionResult> {
  const timeoutMs = options.timeout_ms || 30000;
  const { cmd, args } = getCommand(filename, language);
  const commandStr = getCommandString(filename, language);

  return new Promise((resolve) => {
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';
    let killed = false;

    const proc = spawn(cmd, args, {
      cwd: path.resolve(workingDir),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

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
      const duration_ms = Date.now() - startTime;
      resolve({
        exit_code: killed ? null : code,
        stdout: stdout.slice(0, MAX_OUTPUT_SIZE),
        stderr: killed ? stderr.slice(0, MAX_OUTPUT_SIZE) + '\n[Process timed out]' : stderr.slice(0, MAX_OUTPUT_SIZE),
        duration_ms,
        command: commandStr,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      const duration_ms = Date.now() - startTime;
      resolve({
        exit_code: null,
        stdout: '',
        stderr: err.message,
        duration_ms,
        command: commandStr,
      });
    });
  });
}
