import { api } from './api';
import { Session, SessionDetail, SessionStatus } from '../types';

interface ListParams {
  session_type?: string;
  status?: string;
  language?: string;
  tag?: string;
  search?: string;
}

export const sessionService = {
  async list(params: ListParams = {}): Promise<Session[]> {
    const query = new URLSearchParams();
    for (const [key, val] of Object.entries(params)) {
      if (val) query.set(key, val);
    }
    const qs = query.toString();
    return api.get<Session[]>(`/sessions${qs ? `?${qs}` : ''}`);
  },

  async get(id: string): Promise<SessionDetail> {
    return api.get<SessionDetail>(`/sessions/${id}`);
  },

  async create(data: {
    title: string;
    session_type: string;
    language: string;
    tags?: string[];
    links?: unknown[];
    problem_url?: string;
    repo_url?: string;
  }): Promise<Session> {
    return api.post<Session>('/sessions', data);
  },

  async update(id: string, data: Partial<Pick<Session, 'title' | 'tags' | 'notes' | 'status' | 'links' | 'language'>>): Promise<Session> {
    return api.put<Session>(`/sessions/${id}`, data);
  },

  async updateStatus(id: string, status: SessionStatus): Promise<Session> {
    return api.patch<Session>(`/sessions/${id}/status`, { status });
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/sessions/${id}`);
  },
};
