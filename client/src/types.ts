export type SessionType = 'freeform' | 'cp' | 'repo' | 'lean';
export type SessionStatus = 'active' | 'paused' | 'completed' | 'archived';
export type Language = 'python' | 'julia' | 'cpp' | 'lean' | 'mixed';
export type FileType = 'source' | 'output' | 'plot' | 'data' | 'other';
export type Verdict = 'unsolved' | 'accepted' | 'wrong_answer' | 'time_limit' | 'runtime_error' | 'attempted';
export type Judge = 'codeforces' | 'atcoder' | 'leetcode' | 'other';
export type LinkApp = 'navigate' | 'scribe' | 'monolith' | 'granary';
export type RefType = 'arxiv_id' | 'paper_id' | 'note_id' | 'flowchart_node' | 'project' | 'entry_id';

export interface SessionLink {
  app: LinkApp;
  ref_type: RefType;
  ref_id: string;
  label?: string;
}

export interface Session {
  id: string;
  title: string;
  session_type: SessionType;
  language: string;
  tags: string[];
  status: SessionStatus;
  links: SessionLink[];
  notes: string;
  working_dir: string;
  created_at: string;
  updated_at: string;
}

export interface SessionFile {
  id: string;
  session_id: string;
  filename: string;
  file_type: FileType;
  language: string;
  is_primary: number;
  created_at: string;
  updated_at: string;
}

export interface ExecutionRun {
  id: string;
  session_id: string;
  file_id: string;
  command: string;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  duration_ms: number;
  created_at: string;
}

export interface CpProblem {
  id: string;
  session_id: string;
  judge: Judge;
  problem_url: string;
  problem_id: string;
  problem_name: string;
  difficulty: string | null;
  topics: string[];
  verdict: Verdict;
  attempts: number;
  solved_at: string | null;
  editorial_notes: string;
  created_at: string;
  updated_at: string;
  session_title?: string;
  language?: string;
}

export interface TestCase {
  id: string;
  problem_id: string;
  input: string;
  expected_output: string;
  is_sample: number;
  created_at: string;
}

export interface RepoExploration {
  id: string;
  session_id: string;
  repo_url: string;
  repo_name: string;
  clone_path: string;
  branch: string;
  readme_summary: string;
  interesting_files: string[];
  created_at: string;
  updated_at: string;
  session_title?: string;
  session_status?: string;
}

export type LakeStatus = 'initializing' | 'ready' | 'building' | 'error';

export interface LeanSessionMeta {
  id: string;
  session_id: string;
  lean_version: string;
  mathlib_version: string;
  project_path: string;
  lake_status: LakeStatus;
  last_build_output: string;
  last_build_at: string | null;
  created_at: string;
  updated_at: string;
  absolute_project_path?: string;
}

export interface SessionDetail extends Session {
  files: SessionFile[];
  runs: ExecutionRun[];
  problem?: CpProblem & { test_cases?: TestCase[] };
  test_cases?: TestCase[];
  repo?: RepoExploration;
  lean_meta?: LeanSessionMeta;
}

export interface TestResult {
  test_case_id: string;
  input: string;
  expected_output: string;
  actual_output: string;
  passed: boolean;
  exit_code: number | null;
  stderr: string;
  duration_ms: number;
}

export interface StatsOverview {
  sessions_by_type: { session_type: string; count: number }[];
  active_count: number;
  total_runs: number;
  cp_total: number;
  cp_solved: number;
  cp_solve_rate: number;
}

export interface HeatmapEntry {
  date: string;
  count: number;
}

export interface FileTreeEntry {
  name: string;
  path: string;
  type: 'directory' | 'file';
}
