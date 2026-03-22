import Database, { type Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'pyramid.db');

// Ensure data directories exist
fs.mkdirSync(path.join(DATA_DIR, 'sessions'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'repos'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'lean-projects'), { recursive: true });

const db: DatabaseType = new Database(DB_PATH);

// Enable WAL mode and foreign keys
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    session_type TEXT NOT NULL DEFAULT 'freeform'
      CHECK (session_type IN ('freeform', 'cp', 'repo', 'lean')),
    language TEXT NOT NULL DEFAULT 'python',
    tags TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'paused', 'completed', 'archived')),
    links TEXT NOT NULL DEFAULT '[]',
    notes TEXT NOT NULL DEFAULT '',
    working_dir TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS session_files (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_type TEXT NOT NULL DEFAULT 'source'
      CHECK (file_type IN ('source', 'output', 'plot', 'data', 'other')),
    language TEXT NOT NULL DEFAULT '',
    is_primary INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS execution_runs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    file_id TEXT NOT NULL,
    command TEXT NOT NULL,
    exit_code INTEGER,
    stdout TEXT NOT NULL DEFAULT '',
    stderr TEXT NOT NULL DEFAULT '',
    duration_ms INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (file_id) REFERENCES session_files(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS cp_problems (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL UNIQUE,
    judge TEXT NOT NULL,
    problem_url TEXT NOT NULL,
    problem_id TEXT NOT NULL,
    problem_name TEXT NOT NULL DEFAULT '',
    difficulty TEXT,
    topics TEXT NOT NULL DEFAULT '[]',
    verdict TEXT NOT NULL DEFAULT 'unsolved'
      CHECK (verdict IN ('unsolved', 'accepted', 'wrong_answer', 'time_limit', 'runtime_error', 'attempted')),
    attempts INTEGER NOT NULL DEFAULT 0,
    solved_at TEXT,
    editorial_notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS test_cases (
    id TEXT PRIMARY KEY,
    problem_id TEXT NOT NULL,
    input TEXT NOT NULL,
    expected_output TEXT NOT NULL,
    is_sample INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    FOREIGN KEY (problem_id) REFERENCES cp_problems(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS repo_explorations (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL UNIQUE,
    repo_url TEXT NOT NULL,
    repo_name TEXT NOT NULL,
    clone_path TEXT NOT NULL,
    branch TEXT NOT NULL DEFAULT 'main',
    readme_summary TEXT NOT NULL DEFAULT '',
    interesting_files TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS lean_session_meta (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL UNIQUE,
    lean_version TEXT NOT NULL,
    mathlib_version TEXT NOT NULL DEFAULT '',
    project_path TEXT NOT NULL,
    lake_status TEXT NOT NULL DEFAULT 'initializing'
      CHECK (lake_status IN ('initializing', 'ready', 'building', 'error')),
    last_build_output TEXT NOT NULL DEFAULT '',
    last_build_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Create indices
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_sessions_type ON sessions(session_type);
  CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
  CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at);
  CREATE INDEX IF NOT EXISTS idx_session_files_session ON session_files(session_id);
  CREATE INDEX IF NOT EXISTS idx_runs_session ON execution_runs(session_id);
  CREATE INDEX IF NOT EXISTS idx_runs_created ON execution_runs(created_at);
  CREATE INDEX IF NOT EXISTS idx_cp_session ON cp_problems(session_id);
  CREATE INDEX IF NOT EXISTS idx_cp_judge ON cp_problems(judge);
  CREATE INDEX IF NOT EXISTS idx_cp_verdict ON cp_problems(verdict);
  CREATE INDEX IF NOT EXISTS idx_test_cases_problem ON test_cases(problem_id);
  CREATE INDEX IF NOT EXISTS idx_repo_session ON repo_explorations(session_id);
  CREATE INDEX IF NOT EXISTS idx_lean_meta_session ON lean_session_meta(session_id);
`);

// FTS5 virtual table for sessions search
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
    title,
    notes,
    tags,
    content='sessions',
    content_rowid='rowid'
  );
`);

// FTS sync triggers
db.exec(`
  CREATE TRIGGER IF NOT EXISTS sessions_ai AFTER INSERT ON sessions BEGIN
    INSERT INTO sessions_fts(rowid, title, notes, tags)
    VALUES (NEW.rowid, NEW.title, NEW.notes, NEW.tags);
  END;

  CREATE TRIGGER IF NOT EXISTS sessions_ad AFTER DELETE ON sessions BEGIN
    INSERT INTO sessions_fts(sessions_fts, rowid, title, notes, tags)
    VALUES ('delete', OLD.rowid, OLD.title, OLD.notes, OLD.tags);
  END;

  CREATE TRIGGER IF NOT EXISTS sessions_au AFTER UPDATE ON sessions BEGIN
    INSERT INTO sessions_fts(sessions_fts, rowid, title, notes, tags)
    VALUES ('delete', OLD.rowid, OLD.title, OLD.notes, OLD.tags);
    INSERT INTO sessions_fts(rowid, title, notes, tags)
    VALUES (NEW.rowid, NEW.title, NEW.notes, NEW.tags);
  END;
`);

export default db;
