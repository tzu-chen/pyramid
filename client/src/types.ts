// Freeform language sessions are first-class session types; lean and notebook
// are the two structured types. "Freeform-like" === anything that isn't lean
// or notebook (see isFreeformType).
export const FREEFORM_SESSION_TYPES = ['python', 'cpp', 'ocaml', 'julia'] as const;
export type FreeformSessionType = (typeof FREEFORM_SESSION_TYPES)[number];
export type SessionType = FreeformSessionType | 'lean' | 'notebook';
export type SessionStatus = 'active' | 'paused' | 'completed' | 'archived';
export type Language = 'python' | 'julia' | 'cpp' | 'ocaml' | 'lean';

export function isFreeformType(sessionType: string): boolean {
  return sessionType !== 'lean' && sessionType !== 'notebook';
}
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
  // Peak resident set size (bytes) during the run; null when unavailable
  // (non-Linux host, or process exited before any sample).
  peak_rss_bytes?: number | null;
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
  absolute_working_dir?: string;
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

export type BackendCategory = 'language' | 'lsp' | 'build_tool' | 'debugger' | 'kernel' | 'project_tool';
export type BackendStatus = 'available' | 'missing' | 'error';

export interface BackendInfo {
  key: string;
  name: string;
  command: string;
  category: BackendCategory;
  used_for: string[];
  status: BackendStatus;
  path: string | null;
  version: string | null;
  raw: string | null;
  error: string | null;
}

export interface BackendsResponse {
  checked_at: string;
  node_version: string;
  platform: string;
  backends: BackendInfo[];
}

export type RunningServiceKind = 'lsp' | 'kernel' | 'dap' | 'terminal';

export interface RunningServiceInfo {
  kind: RunningServiceKind;
  name: string;
  command: string;
  pid: number | null;
  started_at: number;
  client_count?: number;
  ready?: boolean;
  tab_id?: string;
  cols?: number;
  rows?: number;
}

export interface RunningSessionInfo {
  session_id: string;
  title: string | null;
  session_type: string | null;
  language: string | null;
  status: string | null;
  services: RunningServiceInfo[];
}

export interface RunningSessionsResponse {
  checked_at: string;
  session_count: number;
  service_count: number;
  sessions: RunningSessionInfo[];
}
