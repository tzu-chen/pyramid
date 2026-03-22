import { api } from './api';
import { ExecutionRun } from '../types';

export const executionService = {
  async execute(sessionId: string, data?: {
    file_id?: string;
    timeout_ms?: number;
    stdin?: string;
  }): Promise<ExecutionRun> {
    return api.post<ExecutionRun>(`/sessions/${sessionId}/execute`, data || {});
  },

  async listRuns(sessionId: string, limit = 50): Promise<ExecutionRun[]> {
    return api.get<ExecutionRun[]>(`/sessions/${sessionId}/runs?limit=${limit}`);
  },

  async getRun(sessionId: string, runId: string): Promise<ExecutionRun> {
    return api.get<ExecutionRun>(`/sessions/${sessionId}/runs/${runId}`);
  },
};
