import { api } from './api';
import { BackendsResponse, RunningSessionsResponse } from '../types';

export const backendsService = {
  async list(): Promise<BackendsResponse> {
    return api.get<BackendsResponse>('/backends');
  },

  async listRunning(): Promise<RunningSessionsResponse> {
    return api.get<RunningSessionsResponse>('/backends/running');
  },
};
