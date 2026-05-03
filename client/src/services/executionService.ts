import { api } from './api';
import { ExecutionRun } from '../types';
import type { BuildFlavor, ExecuteResult } from './cppBuildService';

export const executionService = {
  /**
   * Execute the active file. For C++ sessions containing a CMakeLists.txt, the
   * server runs the CMake build/run dispatch and returns a discriminated
   * `ExecuteResult` instead of the bare ExecutionRun. Callers that don't care
   * can keep using the result directly — `kind: undefined` matches the legacy
   * single-file shape.
   */
  async execute(
    sessionId: string,
    data?: {
      file_id?: string;
      timeout_ms?: number;
      stdin?: string;
      flavor?: BuildFlavor;
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
