import { api } from './api';
import { CpProblem, TestCase, TestResult } from '../types';

export const cpService = {
  async listProblems(params: { judge?: string; verdict?: string; topic?: string } = {}): Promise<CpProblem[]> {
    const query = new URLSearchParams();
    for (const [key, val] of Object.entries(params)) {
      if (val) query.set(key, val);
    }
    const qs = query.toString();
    return api.get<CpProblem[]>(`/cp/problems${qs ? `?${qs}` : ''}`);
  },

  async getProblem(id: string): Promise<CpProblem & { test_cases: TestCase[] }> {
    return api.get(`/cp/problems/${id}`);
  },

  async updateProblem(id: string, data: Partial<CpProblem>): Promise<CpProblem> {
    return api.put<CpProblem>(`/cp/problems/${id}`, data);
  },

  async runTests(problemId: string): Promise<{ results: TestResult[]; all_passed: boolean }> {
    return api.post(`/cp/problems/${problemId}/test`);
  },

  async fetchTests(problemId: string): Promise<TestCase[]> {
    return api.post(`/cp/problems/${problemId}/fetch-tests`);
  },

  async listTestCases(problemId: string): Promise<TestCase[]> {
    return api.get<TestCase[]>(`/cp/problems/${problemId}/tests`);
  },

  async addTestCase(problemId: string, data: { input: string; expected_output: string }): Promise<TestCase> {
    return api.post<TestCase>(`/cp/problems/${problemId}/tests`, data);
  },

  async removeTestCase(problemId: string, testId: string): Promise<void> {
    await api.delete(`/cp/problems/${problemId}/tests/${testId}`);
  },
};
