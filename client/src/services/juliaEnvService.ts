import { api } from './api';
import { PackageList } from '../types';

export interface JuliaManifest {
  manifest: string;
}

// Julia Pkg dependency management — the Pkg.jl analog of cargoEnvService. The
// PackageList shape is shared (declared / installed / lockPresent), so the
// generalized PackagesPanel renders uv, cargo, and Pkg from the same component.
// Julia has no main/dev split in basic Pkg, so `dev` is ignored.
export const juliaEnvService = {
  async getPackages(sessionId: string): Promise<PackageList> {
    return api.get<PackageList>(`/julia-env/${sessionId}/packages`);
  },

  async addPackage(sessionId: string, name: string, _dev = false): Promise<PackageList> {
    return api.post<PackageList>(`/julia-env/${sessionId}/packages`, { name });
  },

  async removePackage(sessionId: string, name: string): Promise<PackageList> {
    return api.delete<PackageList>(`/julia-env/${sessionId}/packages/${encodeURIComponent(name)}`);
  },

  async getManifest(sessionId: string): Promise<JuliaManifest> {
    return api.get<JuliaManifest>(`/julia-env/${sessionId}/manifest`);
  },

  async putManifest(sessionId: string, manifest: string): Promise<PackageList> {
    return api.put<PackageList>(`/julia-env/${sessionId}/manifest`, { manifest });
  },
};
