import { api } from './api';
import { StatsOverview, HeatmapEntry } from '../types';

export const statsService = {
  async getOverview(): Promise<StatsOverview> {
    return api.get<StatsOverview>('/stats/overview');
  },

  async getHeatmap(start?: string, end?: string): Promise<HeatmapEntry[]> {
    const query = new URLSearchParams();
    if (start) query.set('start', start);
    if (end) query.set('end', end);
    const qs = query.toString();
    return api.get<HeatmapEntry[]>(`/stats/heatmap${qs ? `?${qs}` : ''}`);
  },

  async getCpStats(): Promise<{
    by_verdict: { verdict: string; count: number }[];
    by_judge: { judge: string; count: number }[];
    solve_rate_over_time: { date: string; count: number }[];
  }> {
    return api.get('/stats/cp');
  },

  async getLanguages(): Promise<{ language: string; count: number }[]> {
    return api.get('/stats/languages');
  },
};
