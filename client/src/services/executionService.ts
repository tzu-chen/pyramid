import { api } from './api';
import { ExecutionRun } from '../types';
import type { BuildFlavor, ExecuteResult } from './cppBuildService';
import type { DuneFlavor } from './duneBuildService';
import type { CargoFlavor } from './cargoBuildService';

export const executionService = {
  /**
   * Execute the active file. For C++ sessions containing a CMakeLists.txt, the
   * server runs the CMake build/run dispatch and returns a discriminated
   * `ExecuteResult`. For OCaml sessions containing a dune-project, the dune
   * dispatch runs instead — same response shape. Single-file path returns the
   * bare ExecutionRun (kind=undefined).
   */
  async execute(
    sessionId: string,
    data?: {
      file_id?: string;
      timeout_ms?: number;
      stdin?: string;
      flavor?: BuildFlavor | DuneFlavor | CargoFlavor;
      target?: string;
      args?: string[];
      reconfigure?: boolean;
    },
  ): Promise<ExecuteResult> {
    return api.post<ExecuteResult>(`/sessions/${sessionId}/execute`, data || {});
  },

  async listRuns(sessionId: string, limit = 50): Promise<ExecutionRun[]> {
    return api.get<ExecutionRun[]>(`/sessions/${sessionId}/runs?limit=${limit}`);
  },

  async getRun(sessionId: string, runId: string): Promise<ExecutionRun> {
    return api.get<ExecutionRun>(`/sessions/${sessionId}/runs/${runId}`);
  },
};
