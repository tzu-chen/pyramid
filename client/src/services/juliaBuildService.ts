import { api } from './api';
import type {
  BuildHistoryEntry,
  CompilerDiagnostic,
  BuildResponse,
} from './cppBuildService';

// Julia "build" pipeline — the interpreted analog of cargo build/test. There are
// no flavors or artifacts (Julia compiles to a global depot cache, not a
// session-local binary); the mode picks precompile vs test. Reuses the shared
// BuildResponse / BuildPanel like cpp/dune/cargo.
export type JuliaBuildMode = 'precompile' | 'test';

export interface JuliaStatus {
  is_julia_project: boolean;
  project_path: string;
}

export const juliaBuildService = {
  status(sessionId: string): Promise<JuliaStatus> {
    return api.get(`/sessions/${sessionId}/julia/status`);
  },

  build(sessionId: string, mode: JuliaBuildMode): Promise<BuildResponse> {
    return api.post(`/sessions/${sessionId}/julia/build`, { mode });
  },

  history(sessionId: string, limit = 50): Promise<BuildHistoryEntry[]> {
    return api.get(`/sessions/${sessionId}/julia/builds?limit=${limit}`);
  },

  detail(sessionId: string, buildId: string): Promise<BuildHistoryEntry & { log: string; diagnostics: CompilerDiagnostic[] }> {
    return api.get(`/sessions/${sessionId}/julia/builds/${buildId}`);
  },
};
