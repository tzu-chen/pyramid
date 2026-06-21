import { api } from './api';
import { PackageList } from '../types';

export interface CargoManifest {
  manifest: string;
}

// Cargo dependency management — the crates.io analog of pythonEnvService. The
// PackageList shape is shared (declared / installed / lockPresent), so the
// generalized PackagesPanel renders both uv and cargo from the same component.
export const cargoEnvService = {
  async getPackages(sessionId: string): Promise<PackageList> {
    return api.get<PackageList>(`/cargo-env/${sessionId}/packages`);
  },

  async addPackage(sessionId: string, name: string, dev = false): Promise<PackageList> {
    return api.post<PackageList>(`/cargo-env/${sessionId}/packages`, { name, dev });
  },

  async removePackage(sessionId: string, name: string): Promise<PackageList> {
    return api.delete<PackageList>(`/cargo-env/${sessionId}/packages/${encodeURIComponent(name)}`);
  },

  async getManifest(sessionId: string): Promise<CargoManifest> {
    return api.get<CargoManifest>(`/cargo-env/${sessionId}/manifest`);
  },

  async putManifest(sessionId: string, manifest: string): Promise<PackageList> {
    return api.put<PackageList>(`/cargo-env/${sessionId}/manifest`, { manifest });
  },
};
