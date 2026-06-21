import { api } from './api';
import { ExecutionRun } from '../types';
import type {
  BuildHistoryEntry,
  CompilerDiagnostic,
  BuildResponse,
  ArtifactNode,
  ArtifactTextResult,
} from './cppBuildService';

// Cargo's flavor: a profile plus optional feature selection. Features are the
// Rust analog of C++ sanitizer flavors — a build dimension orthogonal to the
// profile. Kept as its own type so a cargo flavor can't be passed where a
// CMake/dune one is expected.
export type CargoProfile = 'dev' | 'release';

export interface CargoFlavor {
  profile: CargoProfile;
  features?: string[];
  allFeatures?: boolean;
  noDefaultFeatures?: boolean;
}

export interface CargoStatus {
  is_cargo_project: boolean;
  project_path: string;
}

// A cargo diagnostic carries rustc's error code / clippy lint name in addition
// to the shared compiler-diagnostic fields.
export interface CargoDiagnostic extends CompilerDiagnostic {
  code?: string | null;
}

export interface CargoBuildResponse extends BuildResponse {}

export interface ClippyResponse {
  build_id: string;
  flavor: string;
  success: boolean;
  duration_ms: number;
  diagnostics: CargoDiagnostic[];
  log: string;
}

export interface CargoTestResponse {
  success: boolean;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  duration_ms: number;
  command: string;
}

export interface CargoBinaryInfo {
  path: string;
  name: string;
}

export interface CargoBinariesResponse {
  flavor: string;
  binaries: CargoBinaryInfo[];
}

// Same discriminated-union shape as cpp/dune's ExecuteResult — the routes
// dispatch on session language, so the runtime shape is identical.
export type CargoExecuteResult =
  | (ExecutionRun & { kind?: undefined })
  | {
      kind: 'ran';
      build_id: string;
      flavor: string;
      success: true;
      diagnostics: CargoDiagnostic[];
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
      diagnostics: CargoDiagnostic[];
      log: string;
      duration_ms: number;
    }
  | {
      kind: 'no_binary';
      build_id: string;
      flavor: string;
      success: false;
      diagnostics: CargoDiagnostic[];
      log: string;
      duration_ms: number;
    };

export const cargoBuildService = {
  status(sessionId: string): Promise<CargoStatus> {
    return api.get(`/sessions/${sessionId}/cargo/status`);
  },

  build(
    sessionId: string,
    flavor: CargoFlavor,
    opts?: { target?: string; jobs?: number },
  ): Promise<CargoBuildResponse> {
    return api.post(`/sessions/${sessionId}/cargo/build`, { flavor, ...opts });
  },

  clippy(sessionId: string, flavor: CargoFlavor): Promise<ClippyResponse> {
    return api.post(`/sessions/${sessionId}/cargo/clippy`, { flavor });
  },

  test(sessionId: string, flavor: CargoFlavor): Promise<CargoTestResponse> {
    return api.post(`/sessions/${sessionId}/cargo/test`, { flavor });
  },

  history(sessionId: string, limit = 50): Promise<BuildHistoryEntry[]> {
    return api.get(`/sessions/${sessionId}/cargo/builds?limit=${limit}`);
  },

  detail(sessionId: string, buildId: string): Promise<BuildHistoryEntry & { log: string; diagnostics: CargoDiagnostic[] }> {
    return api.get(`/sessions/${sessionId}/cargo/builds/${buildId}`);
  },

  binaries(sessionId: string, flavor: CargoFlavor): Promise<CargoBinariesResponse> {
    return api.get(`/sessions/${sessionId}/cargo/binaries?profile=${flavor.profile}`);
  },

  clean(
    sessionId: string,
    arg: { all: true } | { flavor: CargoFlavor },
  ): Promise<{ removed: boolean; scope: string }> {
    return api.post(`/sessions/${sessionId}/cargo/clean`, arg);
  },

  artifactTree(sessionId: string): Promise<{ tree: ArtifactNode[] }> {
    return api.get(`/sessions/${sessionId}/cargo/artifacts`);
  },

  artifactText(sessionId: string, relPath: string): Promise<ArtifactTextResult> {
    return api.get(`/sessions/${sessionId}/cargo/artifacts/content?path=${encodeURIComponent(relPath)}`);
  },

  artifactDownloadUrl(sessionId: string, relPath: string): string {
    return `/api/sessions/${sessionId}/cargo/artifacts/download?path=${encodeURIComponent(relPath)}`;
  },
};

export const CARGO_PROFILE_PRESETS: ReadonlyArray<{ id: CargoProfile; label: string; flavor: CargoFlavor }> = [
  { id: 'dev',     label: 'dev (debug)', flavor: { profile: 'dev' } },
  { id: 'release', label: 'release',     flavor: { profile: 'release' } },
];

export function cargoFlavorIdFromObj(flavor: CargoFlavor): string {
  return flavor.profile;
}

export function cargoFlavorFromId(id: string): CargoFlavor {
  const preset = CARGO_PROFILE_PRESETS.find((p) => p.id === id);
  if (preset) return preset.flavor;
  return { profile: 'dev' };
}
