import { api } from './api';
import { PythonSessionMeta, PackageList, PythonManifest } from '../types';

export const pythonEnvService = {
  async getMeta(sessionId: string): Promise<PythonSessionMeta> {
    return api.get<PythonSessionMeta>(`/python-env/${sessionId}/meta`);
  },

  async getPackages(sessionId: string): Promise<PackageList> {
    return api.get<PackageList>(`/python-env/${sessionId}/packages`);
  },

  async addPackage(sessionId: string, name: string, dev = false): Promise<PackageList> {
    return api.post<PackageList>(`/python-env/${sessionId}/packages`, { name, dev });
  },

  async removePackage(sessionId: string, name: string): Promise<PackageList> {
    return api.delete<PackageList>(`/python-env/${sessionId}/packages/${encodeURIComponent(name)}`);
  },

  async getManifest(sessionId: string): Promise<PythonManifest> {
    return api.get<PythonManifest>(`/python-env/${sessionId}/manifest`);
  },

  async putManifest(sessionId: string, pyproject: string): Promise<PackageList> {
    return api.put<PackageList>(`/python-env/${sessionId}/manifest`, { pyproject });
  },

  async sync(sessionId: string): Promise<PackageList> {
    return api.post<PackageList>(`/python-env/${sessionId}/sync`);
  },

  async lock(sessionId: string): Promise<PackageList> {
    return api.post<PackageList>(`/python-env/${sessionId}/lock`);
  },

  async pruneCache(): Promise<{ ok: boolean; output: string }> {
    return api.post<{ ok: boolean; output: string }>(`/python-env/cache/prune`);
  },
};
