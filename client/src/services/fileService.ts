import { api } from './api';
import { SessionFile } from '../types';

export const fileService = {
  async list(sessionId: string): Promise<SessionFile[]> {
    return api.get<SessionFile[]>(`/sessions/${sessionId}/files`);
  },

  async getContent(sessionId: string, fileId: string): Promise<string> {
    return api.get<string>(`/sessions/${sessionId}/files/${fileId}/content`);
  },

  async create(sessionId: string, data: {
    filename: string;
    language?: string;
    content?: string;
    is_primary?: boolean;
    file_type?: string;
  }): Promise<SessionFile> {
    return api.post<SessionFile>(`/sessions/${sessionId}/files`, data);
  },

  async updateContent(sessionId: string, fileId: string, content: string): Promise<void> {
    await api.put(`/sessions/${sessionId}/files/${fileId}/content`, { content });
  },

  async remove(sessionId: string, fileId: string): Promise<void> {
    await api.delete(`/sessions/${sessionId}/files/${fileId}`);
  },
};
