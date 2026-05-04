// Compiler Explorer (godbolt.org) REST API client.
//
// Docs: https://github.com/compiler-explorer/compiler-explorer/blob/main/docs/API.md

const GODBOLT_BASE = 'https://godbolt.org';
const TIMEOUT_MS = 20_000;
const COMPILER_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export interface GodboltCompiler {
  id: string;
  name: string;
  lang: string;
  compilerType?: string;
  semver?: string;
  instructionSet?: string;
}

export interface GodboltAsmSource {
  file?: string | null;
  line?: number | null;
  column?: number | null;
}

export interface GodboltAsmLine {
  text: string;
  source?: GodboltAsmSource | null;
  opcodes?: string[];
}

export interface GodboltCompileResponse {
  code: number;
  asm: GodboltAsmLine[];
  stdout: { text: string }[];
  stderr: { text: string }[];
  execTime?: string;
  compilationOptions?: string[];
  truncated?: boolean;
}

export interface GodboltFilters {
  binary?: boolean;
  binaryObject?: boolean;
  commentOnly?: boolean;
  demangle?: boolean;
  directives?: boolean;
  execute?: boolean;
  intel?: boolean;
  labels?: boolean;
  libraryCode?: boolean;
  trim?: boolean;
}

const DEFAULT_FILTERS: GodboltFilters = {
  binary: false,
  binaryObject: false,
  commentOnly: true,
  demangle: true,
  directives: true,
  execute: false,
  intel: true,
  labels: true,
  libraryCode: false,
  trim: false,
};

interface CacheEntry<T> {
  fetchedAt: number;
  data: T;
}

const compilerCache = new Map<string, CacheEntry<GodboltCompiler[]>>();

async function godboltFetch(path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${GODBOLT_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Pyramid/1.0 (+https://github.com/tzu-chen)',
        ...(init?.headers ?? {}),
      },
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function listGodboltCompilers(language: string): Promise<GodboltCompiler[]> {
  const lang = language.trim().toLowerCase();
  const cached = compilerCache.get(lang);
  if (cached && Date.now() - cached.fetchedAt < COMPILER_CACHE_TTL_MS) {
    return cached.data;
  }

  // /api/compilers/<lang> returns the list filtered to that language.
  const res = await godboltFetch(`/api/compilers/${encodeURIComponent(lang)}?fields=id,name,lang,compilerType,semver,instructionSet`);
  if (!res.ok) {
    throw new Error(`godbolt compilers HTTP ${res.status}`);
  }
  const data = await res.json() as GodboltCompiler[];
  // Sort: stable name order, prefer common compilers up top.
  const POPULAR = /^(g|clang|cl|icx|icpx|riscv|aarch|arm)/i;
  data.sort((a, b) => {
    const ap = POPULAR.test(a.name) ? 0 : 1;
    const bp = POPULAR.test(b.name) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return a.name.localeCompare(b.name);
  });
  compilerCache.set(lang, { fetchedAt: Date.now(), data });
  return data;
}

export interface CompileRequest {
  compilerId: string;
  source: string;
  userArguments?: string;
  filters?: GodboltFilters;
}

export async function compileWithGodbolt(req: CompileRequest): Promise<GodboltCompileResponse> {
  const filters = { ...DEFAULT_FILTERS, ...(req.filters ?? {}) };
  const body = {
    source: req.source,
    options: {
      userArguments: req.userArguments ?? '',
      compilerOptions: { skipAsm: false, executorRequest: false },
      filters,
    },
    lang: 'c++',
    allowStoreCodeDebug: false,
  };

  const res = await godboltFetch(`/api/compiler/${encodeURIComponent(req.compilerId)}/compile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`godbolt compile HTTP ${res.status}`);
  }
  const json = await res.json() as Partial<GodboltCompileResponse>;
  return {
    code: typeof json.code === 'number' ? json.code : -1,
    asm: Array.isArray(json.asm) ? json.asm : [],
    stdout: Array.isArray(json.stdout) ? json.stdout : [],
    stderr: Array.isArray(json.stderr) ? json.stderr : [],
    execTime: json.execTime,
    compilationOptions: json.compilationOptions,
    truncated: json.truncated,
  };
}
