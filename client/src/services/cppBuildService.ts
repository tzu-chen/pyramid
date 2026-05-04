import { api } from './api';
import { ExecutionRun } from '../types';

export type BuildType = 'Debug' | 'Release' | 'RelWithDebInfo' | 'MinSizeRel';
export type Sanitizer = 'asan' | 'tsan' | 'ubsan' | 'msan';

export interface BuildFlavor {
  buildType: BuildType;
  sanitizers?: Sanitizer[];
}

export interface CompilerDiagnostic {
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'note';
  message: string;
}

export interface CmakeStatus {
  is_cmake_project: boolean;
  project_path: string;
}

export interface ConfigureResponse {
  success: boolean;
  durationMs: number;
  buildDir: string;
  compileCommandsPath: string;
  log: string;
  flavor: string;
}

export interface BuildResponse {
  build_id: string;
  flavor: string;
  success: boolean;
  duration_ms: number;
  diagnostics: CompilerDiagnostic[];
  log: string;
  binary_paths: string[];
}

export interface BuildHistoryEntry {
  id: string;
  session_id: string;
  flavor: string;
  success: number;
  duration_ms: number;
  diagnostic_count: number;
  created_at: string;
}

export interface BuildDetail extends BuildHistoryEntry {
  log: string;
  diagnostics: CompilerDiagnostic[];
}

export interface BinaryInfo {
  path: string;
  name: string;
}

export interface BinariesResponse {
  flavor: string;
  binaries: BinaryInfo[];
}

export type ExecuteResult =
  | (ExecutionRun & { kind?: undefined })
  | {
      kind: 'ran';
      build_id: string;
      flavor: string;
      success: true;
      diagnostics: CompilerDiagnostic[];
      build_log: string;
      build_duration_ms: number;
      binary_path: string;
      run: ExecutionRun;
    }
  | {
      kind: 'build_failed';
      build_id: string;
      flavor: string;
      success: false;
      diagnostics: CompilerDiagnostic[];
      log: string;
      duration_ms: number;
    }
  | {
      kind: 'no_binary';
      build_id: string;
      flavor: string;
      success: false;
      diagnostics: CompilerDiagnostic[];
      log: string;
      duration_ms: number;
    };

export const cppBuildService = {
  status(sessionId: string): Promise<CmakeStatus> {
    return api.get(`/sessions/${sessionId}/cmake/status`);
  },

  configure(
    sessionId: string,
    flavor: BuildFlavor,
    reconfigure = false,
  ): Promise<ConfigureResponse> {
    return api.post(`/sessions/${sessionId}/cmake/configure`, { flavor, reconfigure });
  },

  build(
    sessionId: string,
    flavor: BuildFlavor,
    opts?: { target?: string; jobs?: number; reconfigure?: boolean },
  ): Promise<BuildResponse> {
    return api.post(`/sessions/${sessionId}/cmake/build`, { flavor, ...opts });
  },

  history(sessionId: string, limit = 50): Promise<BuildHistoryEntry[]> {
    return api.get(`/sessions/${sessionId}/cmake/builds?limit=${limit}`);
  },

  detail(sessionId: string, buildId: string): Promise<BuildDetail> {
    return api.get(`/sessions/${sessionId}/cmake/builds/${buildId}`);
  },

  binaries(sessionId: string, flavor: BuildFlavor): Promise<BinariesResponse> {
    const params = new URLSearchParams({ buildType: flavor.buildType });
    if (flavor.sanitizers?.length) {
      params.set('sanitizers', flavor.sanitizers.join(','));
    }
    return api.get(`/sessions/${sessionId}/cmake/binaries?${params.toString()}`);
  },

  clean(
    sessionId: string,
    arg: { all: true } | { flavor: BuildFlavor },
  ): Promise<{ removed: boolean; scope: string }> {
    return api.post(`/sessions/${sessionId}/cmake/clean`, arg);
  },

  artifactTree(sessionId: string): Promise<{ tree: ArtifactNode[] }> {
    return api.get(`/sessions/${sessionId}/cmake/artifacts`);
  },

  artifactText(sessionId: string, relPath: string): Promise<ArtifactTextResult> {
    return api.get(`/sessions/${sessionId}/cmake/artifacts/content?path=${encodeURIComponent(relPath)}`);
  },

  artifactDownloadUrl(sessionId: string, relPath: string): string {
    return `/api/sessions/${sessionId}/cmake/artifacts/download?path=${encodeURIComponent(relPath)}`;
  },
};

export type ArtifactKind =
  | 'dir'
  | 'executable'
  | 'object'
  | 'archive'
  | 'shared_lib'
  | 'compile_commands'
  | 'cmake'
  | 'text'
  | 'binary';

export interface ArtifactNode {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  kind: ArtifactKind;
  childCount?: number;
  children?: ArtifactNode[];
}

export interface ArtifactTextResult {
  content: string;
  truncated: boolean;
  size: number;
  kind: ArtifactKind;
}

export const FLAVOR_PRESETS: ReadonlyArray<{ id: string; label: string; flavor: BuildFlavor }> = [
  { id: 'Debug',                label: 'Debug',                  flavor: { buildType: 'Debug' } },
  { id: 'Release',              label: 'Release',                flavor: { buildType: 'Release' } },
  { id: 'RelWithDebInfo',       label: 'RelWithDebInfo',         flavor: { buildType: 'RelWithDebInfo' } },
  { id: 'MinSizeRel',           label: 'MinSizeRel',             flavor: { buildType: 'MinSizeRel' } },
  { id: 'Debug-asan',           label: 'Debug + ASan',           flavor: { buildType: 'Debug', sanitizers: ['asan'] } },
  { id: 'Debug-tsan',           label: 'Debug + TSan',           flavor: { buildType: 'Debug', sanitizers: ['tsan'] } },
  { id: 'Debug-ubsan',          label: 'Debug + UBSan',          flavor: { buildType: 'Debug', sanitizers: ['ubsan'] } },
  { id: 'Debug-asan-ubsan',     label: 'Debug + ASan + UBSan',   flavor: { buildType: 'Debug', sanitizers: ['asan', 'ubsan'] } },
];

export function flavorIdFromObj(flavor: BuildFlavor): string {
  const parts: string[] = [flavor.buildType];
  if (flavor.sanitizers?.length) parts.push(...[...flavor.sanitizers].sort());
  return parts.join('-');
}

export function flavorFromId(id: string): BuildFlavor {
  const preset = FLAVOR_PRESETS.find((p) => p.id === id);
  if (preset) return preset.flavor;
  // Fallback: parse known shape
  const parts = id.split('-');
  const buildType = parts[0] as BuildType;
  const sanitizers = parts.slice(1) as Sanitizer[];
  return { buildType, sanitizers: sanitizers.length ? sanitizers : undefined };
}
