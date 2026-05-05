import { api } from './api';
import { BackendsResponse } from '../types';

export const backendsService = {
  async list(): Promise<BackendsResponse> {
    return api.get<BackendsResponse>('/backends');
  },
};
