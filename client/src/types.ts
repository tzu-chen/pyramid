export type SessionType = 'freeform' | 'lean' | 'notebook';
export type SessionStatus = 'active' | 'paused' | 'completed' | 'archived';
export type Language = 'python' | 'julia' | 'cpp' | 'lean';
export type FileType = 'source' | 'output' | 'plot' | 'data' | 'other';
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
  lean_meta?: LeanSessionMeta;
}

export interface StatsOverview {
  sessions_by_type: { session_type: string; count: number }[];
  active_count: number;
  total_runs: number;
}

export interface HeatmapEntry {
  date: string;
  count: number;
}
