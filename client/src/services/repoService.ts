import { api } from './api';
import { RepoExploration, FileTreeEntry } from '../types';

export const repoService = {
  async list(): Promise<RepoExploration[]> {
    return api.get<RepoExploration[]>('/repos');
  },

  async get(id: string): Promise<RepoExploration> {
    return api.get<RepoExploration>(`/repos/${id}`);
  },

  async update(id: string, data: Partial<Pick<RepoExploration, 'readme_summary' | 'interesting_files' | 'branch'>>): Promise<RepoExploration> {
    return api.put<RepoExploration>(`/repos/${id}`, data);
  },

  async getTree(id: string, dirPath = ''): Promise<FileTreeEntry[]> {
    const qs = dirPath ? `?path=${encodeURIComponent(dirPath)}` : '';
    return api.get<FileTreeEntry[]>(`/repos/${id}/tree${qs}`);
  },

  async readFile(id: string, filePath: string): Promise<string> {
    return api.get<string>(`/repos/${id}/file?path=${encodeURIComponent(filePath)}`);
  },
};
