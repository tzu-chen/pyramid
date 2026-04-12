import { api } from './api';
import { SessionFile } from '../types';

const BASE_URL = '/api';

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

  async rename(sessionId: string, fileId: string, newFilename: string): Promise<SessionFile> {
    return api.patch<SessionFile>(`/sessions/${sessionId}/files/${fileId}`, { filename: newFilename });
  },

  async createFolder(sessionId: string, folderPath: string): Promise<void> {
    await api.post(`/sessions/${sessionId}/folders`, { path: folderPath });
  },

  async renameFolder(sessionId: string, oldPath: string, newPath: string): Promise<void> {
    await api.patch(`/sessions/${sessionId}/folders`, { oldPath, newPath });
  },

  async removeFolder(sessionId: string, folderPath: string): Promise<void> {
    await api.delete(`/sessions/${sessionId}/folders?path=${encodeURIComponent(folderPath)}`);
  },

  async upload(sessionId: string, file: File, directory?: string): Promise<SessionFile> {
    const formData = new FormData();
    formData.append('file', file);
    if (directory) {
      formData.append('directory', directory);
    }
    const res = await fetch(`${BASE_URL}/sessions/${sessionId}/upload`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json();
  },

  async listTree(sessionId: string): Promise<string[]> {
    const result = await api.get<{ files: string[] }>(`/sessions/${sessionId}/tree`);
    return result.files;
  },
};
