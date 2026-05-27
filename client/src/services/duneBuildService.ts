import { api } from './api';
import { ExecutionRun } from '../types';
import type {
  BuildHistoryEntry,
  CompilerDiagnostic,
  BuildResponse,
  ArtifactNode,
  ArtifactTextResult,
} from './cppBuildService';

// Dune surfaces its own narrow flavor (just a profile string). Keeping a
// distinct type even though the underlying builds table is shared, so callers
// can't accidentally pass a CMake flavor where a dune one is expected.
export type DuneProfile = 'dev' | 'release';

export interface DuneFlavor {
  profile: DuneProfile;
}

export interface DuneStatus {
  is_dune_project: boolean;
  project_path: string;
}

export interface DuneBuildResponse extends BuildResponse {}

export interface DuneBinaryInfo {
  path: string;
  name: string;
}

export interface DuneBinariesResponse {
  flavor: string;
  binaries: DuneBinaryInfo[];
}

// Same discriminated-union shape as cpp's ExecuteResult, but specialised to
// the dune execute path. The shapes are identical at runtime — the routes
// just dispatch on session language — so the client-side type is the same.
export type DuneExecuteResult =
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

export const duneBuildService = {
  status(sessionId: string): Promise<DuneStatus> {
    return api.get(`/sessions/${sessionId}/dune/status`);
  },

  build(
    sessionId: string,
    flavor: DuneFlavor,
    opts?: { target?: string; jobs?: number },
  ): Promise<DuneBuildResponse> {
    return api.post(`/sessions/${sessionId}/dune/build`, { flavor, ...opts });
  },

  history(sessionId: string, limit = 50): Promise<BuildHistoryEntry[]> {
    return api.get(`/sessions/${sessionId}/dune/builds?limit=${limit}`);
  },

  detail(sessionId: string, buildId: string): Promise<BuildHistoryEntry & { log: string; diagnostics: CompilerDiagnostic[] }> {
    return api.get(`/sessions/${sessionId}/dune/builds/${buildId}`);
  },

  binaries(sessionId: string, flavor: DuneFlavor): Promise<DuneBinariesResponse> {
    return api.get(`/sessions/${sessionId}/dune/binaries?profile=${flavor.profile}`);
  },

  clean(
    sessionId: string,
    arg: { all: true } | { flavor: DuneFlavor },
  ): Promise<{ removed: boolean; scope: string }> {
    return api.post(`/sessions/${sessionId}/dune/clean`, arg);
  },

  artifactTree(sessionId: string): Promise<{ tree: ArtifactNode[] }> {
    return api.get(`/sessions/${sessionId}/dune/artifacts`);
  },

  artifactText(sessionId: string, relPath: string): Promise<ArtifactTextResult> {
    return api.get(`/sessions/${sessionId}/dune/artifacts/content?path=${encodeURIComponent(relPath)}`);
  },

  artifactDownloadUrl(sessionId: string, relPath: string): string {
    return `/api/sessions/${sessionId}/dune/artifacts/download?path=${encodeURIComponent(relPath)}`;
  },
};

export const DUNE_PROFILE_PRESETS: ReadonlyArray<{ id: DuneProfile; label: string; flavor: DuneFlavor }> = [
  { id: 'dev',     label: 'dev (debug)', flavor: { profile: 'dev' } },
  { id: 'release', label: 'release',     flavor: { profile: 'release' } },
];

export function duneFlavorIdFromObj(flavor: DuneFlavor): string {
  return flavor.profile;
}

export function duneFlavorFromId(id: string): DuneFlavor {
  const preset = DUNE_PROFILE_PRESETS.find((p) => p.id === id);
  if (preset) return preset.flavor;
  return { profile: 'dev' };
}
