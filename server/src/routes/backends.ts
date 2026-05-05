import { Router, Request, Response } from 'express';
import { execFile } from 'child_process';

const router = Router();

interface BackendDef {
  key: string;
  name: string;
  command: string;
  args: string[];
  category: 'language' | 'lsp' | 'build_tool' | 'kernel' | 'project_tool';
  used_for: string[];
  // Capture index hint: 'stdout' | 'stderr' | 'both' (some tools print version to stderr)
  stream?: 'stdout' | 'stderr' | 'both';
  // Regex to extract a clean version string
  versionRegex?: RegExp;
}

interface BackendInfo {
  key: string;
  name: string;
  command: string;
  category: BackendDef['category'];
  used_for: string[];
  status: 'available' | 'missing' | 'error';
  path: string | null;
  version: string | null;
  raw: string | null;
  error: string | null;
}

const BACKENDS: BackendDef[] = [
  {
    key: 'python',
    name: 'Python',
    command: 'python3',
    args: ['--version'],
    category: 'language',
    used_for: ['Freeform Python sessions', 'Jupyter notebook kernel'],
    stream: 'both',
    versionRegex: /Python\s+([\d.]+)/,
  },
  {
    key: 'julia',
    name: 'Julia',
    command: 'julia',
    args: ['--version'],
    category: 'language',
    used_for: ['Freeform Julia sessions'],
    versionRegex: /julia version\s+([\d.+\w-]+)/i,
  },
  {
    key: 'gcc',
    name: 'g++',
    command: 'g++',
    args: ['--version'],
    category: 'language',
    used_for: ['C++ single-file execution', 'C++ CMake builds'],
    versionRegex: /g\+\+[^\d]*([\d.]+)/,
  },
  {
    key: 'clangd',
    name: 'clangd',
    command: 'clangd',
    args: ['--version'],
    category: 'lsp',
    used_for: ['C++ language server (diagnostics, hover, completion)'],
    versionRegex: /clangd version\s+([\d.]+)/i,
  },
  {
    key: 'cmake',
    name: 'CMake',
    command: 'cmake',
    args: ['--version'],
    category: 'build_tool',
    used_for: ['C++ project configure and build pipeline'],
    versionRegex: /cmake version\s+([\d.]+)/i,
  },
  {
    key: 'ninja',
    name: 'Ninja',
    command: 'ninja',
    args: ['--version'],
    category: 'build_tool',
    used_for: ['Preferred CMake generator (auto-detected)'],
    versionRegex: /([\d.]+)/,
  },
  {
    key: 'lean',
    name: 'Lean',
    command: 'lean',
    args: ['--version'],
    category: 'language',
    used_for: ['Lean 4 LSP server', 'Lean session execution'],
    stream: 'both',
    versionRegex: /Lean[^\d]*([\d.]+)/,
  },
  {
    key: 'lake',
    name: 'Lake',
    command: 'lake',
    args: ['--version'],
    category: 'project_tool',
    used_for: ['Lake project scaffolding and Mathlib builds'],
    stream: 'both',
    versionRegex: /Lake[^\d]*([\d.]+)/,
  },
  {
    key: 'ipykernel',
    name: 'ipykernel',
    command: 'python3',
    args: ['-c', 'import ipykernel; print(ipykernel.__version__)'],
    category: 'kernel',
    used_for: ['Jupyter notebook execution via jupyter-bridge.py'],
    versionRegex: /([\d.]+)/,
  },
  {
    key: 'git',
    name: 'Git',
    command: 'git',
    args: ['--version'],
    category: 'project_tool',
    used_for: ['Lake/Mathlib dependency management'],
    versionRegex: /git version\s+([\d.]+)/i,
  },
];

function runVersion(command: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number | null; error: Error | null }> {
  return new Promise(resolve => {
    execFile(command, args, { timeout: 3000, maxBuffer: 64 * 1024 }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        code: error && 'code' in error ? (error as NodeJS.ErrnoException).code === 'ENOENT' ? 127 : (error as { code?: number }).code ?? null : 0,
        error: error || null,
      });
    });
  });
}

function whichPath(command: string): Promise<string | null> {
  return new Promise(resolve => {
    execFile('sh', ['-c', `command -v ${command}`], { timeout: 2000 }, (error, stdout) => {
      if (error) { resolve(null); return; }
      const trimmed = (stdout || '').trim();
      resolve(trimmed || null);
    });
  });
}

async function probe(def: BackendDef): Promise<BackendInfo> {
  const stream = def.stream ?? 'stdout';
  const [path, result] = await Promise.all([
    whichPath(def.command),
    runVersion(def.command, def.args),
  ]);

  const isMissing = !path || (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT');

  if (isMissing) {
    return {
      key: def.key,
      name: def.name,
      command: def.command,
      category: def.category,
      used_for: def.used_for,
      status: 'missing',
      path: null,
      version: null,
      raw: null,
      error: null,
    };
  }

  const combined = stream === 'stderr' ? result.stderr
    : stream === 'both' ? `${result.stdout}\n${result.stderr}`
    : result.stdout;
  const trimmed = combined.trim();

  let version: string | null = null;
  if (def.versionRegex) {
    const match = trimmed.match(def.versionRegex);
    if (match) version = match[1];
  }
  if (!version) {
    // Fallback: first non-empty line
    const firstLine = trimmed.split('\n').find(l => l.trim().length > 0);
    if (firstLine) version = firstLine.trim();
  }

  if (result.error && !version) {
    return {
      key: def.key,
      name: def.name,
      command: def.command,
      category: def.category,
      used_for: def.used_for,
      status: 'error',
      path,
      version: null,
      raw: trimmed || null,
      error: result.error.message,
    };
  }

  return {
    key: def.key,
    name: def.name,
    command: def.command,
    category: def.category,
    used_for: def.used_for,
    status: 'available',
    path,
    version,
    raw: trimmed || null,
    error: null,
  };
}

// GET /api/backends
router.get('/', async (_req: Request, res: Response) => {
  try {
    const probed = await Promise.all(BACKENDS.map(probe));
    res.json({
      checked_at: new Date().toISOString(),
      node_version: process.version,
      platform: `${process.platform} ${process.arch}`,
      backends: probed,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
