import { api } from './api';
import { LeanSessionMeta } from '../types';

export const leanService = {
  async getMeta(sessionId: string): Promise<LeanSessionMeta> {
    return api.get<LeanSessionMeta>(`/lean/${sessionId}/meta`);
  },

  async build(sessionId: string): Promise<{ build_output: string; lake_status: string }> {
    return api.post<{ build_output: string; lake_status: string }>(`/lean/${sessionId}/build`);
  },

  async getBuildOutput(sessionId: string): Promise<{ last_build_output: string; last_build_at: string | null; lake_status: string }> {
    return api.get<{ last_build_output: string; last_build_at: string | null; lake_status: string }>(`/lean/${sessionId}/build-output`);
  },
};
