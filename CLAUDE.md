# Pyramid — CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

Pyramid is a **computational workbench** for executing, experimenting, and practicing. It supports three modes of work: numerical/scientific computation (Python/Julia), formal proof verification (Lean), and competitive programming practice (C++/Python via online judges). Sessions are the core abstraction — each session bundles code, outputs, notes, and provenance links into a logged, searchable unit.

Pyramid is part of a personal research tooling ecosystem alongside four sibling projects:

* **Navigate** (arXiv paper management + AI chat) — <https://github.com/tzu-chen/navigate>
* **Scribe** (study tool: PDFs, notes, flowcharts, questions) — <https://github.com/tzu-chen/scribe>
* **Monolith** (local LaTeX editor with Tectonic backend) — <https://github.com/tzu-chen/monolith>
* **Granary** (research log, spaced repetition, inbox) — <https://github.com/tzu-chen/granary>

All five apps share the same tech stack and conventions. When in doubt, reference Granary or Navigate for architectural patterns.

---

## Build & Development Commands

```
npm run install:all       # Install dependencies for root, server/, and client/
npm run dev               # Start both frontend (Vite) and backend (Express) concurrently
npm run dev:server        # Backend only (Express on port 3006, tsx watch for hot reload)
npm run dev:client        # Frontend only (Vite on port 5177)
npm run build             # Build both client and server for production
npm run build:client      # Build frontend only (tsc && vite build)
npm run build:server      # Build backend only (tsc)
npm start                 # Start production server (serves API + built frontend from client/dist/)
```

**Port assignment:** Pyramid uses port **3006** (server) and **5177** (Vite dev) to avoid conflicts with Navigate (3001/5173), Scribe (3003/5173), Monolith (3005/5173), and Granary (3009/5174). The Vite dev server proxies `/api` requests to `http://localhost:3006`.

No `.env` files. The only server environment variable is `PORT` (defaults to 3006).

---

## Architecture

Full-stack TypeScript: React 18 + Vite frontend, Express + SQLite backend. Same structure as Navigate, Scribe, and Granary.

```
pyramid/
├── package.json              # Root scripts (concurrently for dev, install:all)
├── client/                   # React frontend (Vite)
│   ├── src/
│   │   ├── main.tsx          # Entry point
│   │   ├── App.tsx           # Root component, routing, global state
│   │   ├── types.ts          # Shared TypeScript interfaces
│   │   ├── styles/
│   │   │   └── global.css    # CSS custom properties (design tokens), reset, themes
│   │   ├── components/       # Reusable UI components (one folder each)
│   │   ├── pages/            # Route-level page components
│   │   ├── services/         # Data access layer (REST API calls)
│   │   ├── hooks/            # Custom React hooks
│   │   └── contexts/         # React contexts (theme)
│   └── vite.config.ts        # Vite config with /api proxy to port 3006
└── server/                   # Express backend
    ├── src/
    │   ├── index.ts          # Express entry point, mounts route modules
    │   ├── db.ts             # SQLite schema init + migrations
    │   ├── routes/           # RESTful route handlers
    │   └── services/         # Business logic (database, execution, oj integration)
    └── data/                 # Runtime data (gitignored)
        ├── pyramid.db        # SQLite database
        ├── sessions/         # Session working directories (code files, outputs)
        └── repos/            # Cloned GitHub repos for repo-exploration sessions
```

---

## Core Concepts

### Sessions

The fundamental data unit. A session is a timestamped workspace for a specific coding/computation activity.

```
interface Session {
  id: string;                          // UUID
  title: string;                       // User-provided or auto-generated
  session_type: 'freeform' | 'cp' | 'repo' | 'lean';
  language: string;                    // 'python' | 'julia' | 'cpp' | 'lean' | 'mixed'
  tags: string[];                      // JSON array stored as TEXT
  status: 'active' | 'paused' | 'completed' | 'archived';
  links: SessionLink[];                // Cross-app references (see below)
  notes: string;                       // Markdown+LaTeX session notes
  working_dir: string;                 // Relative path under data/sessions/
  created_at: string;                  // ISO 8601
  updated_at: string;                  // ISO 8601
}
```

**Session types:**

* `freeform` — open-ended numerical/scientific experimentation. No structure imposed. The user writes code, runs it, observes results. Used for SPDE simulations, ML experiments, algorithm exploration.
* `cp` — competitive programming. Linked to a problem URL. Has structured fields for problem metadata, test cases, and verdicts. Uses `online-judge-tools` (`oj`) for downloading test cases, local testing, and submission.
* `repo` — GitHub repository exploration. Clones a repo into `data/repos/`, provides browsable source alongside a scratch area for the user's own code. Used for studying open-source codebases.
* `lean` — formal proof writing. Lean 4 execution environment. Used for formalizing mathematical results studied in Scribe or proved in Monolith.

### Session Files

Each session has a working directory under `data/sessions/<session_id>/`. Code files, output logs, and generated artifacts live here. The server tracks files associated with each session.

```
interface SessionFile {
  id: string;                          // UUID
  session_id: string;                  // FK → sessions
  filename: string;                    // e.g., "main.py", "solution.cpp"
  file_type: 'source' | 'output' | 'plot' | 'data' | 'other';
  language: string;                    // File language for syntax highlighting
  is_primary: boolean;                 // The "main" file to execute
  created_at: string;
  updated_at: string;
}
```

File content is stored on the filesystem, not in SQLite. The `session_files` table stores metadata only. File content is read/written via API endpoints that access the working directory.

### Execution Runs

Each code execution within a session is logged.

```
interface ExecutionRun {
  id: string;                          // UUID
  session_id: string;                  // FK → sessions
  file_id: string;                     // FK → session_files (which file was run)
  command: string;                     // The actual command executed (e.g., "python main.py")
  exit_code: number | null;            // Process exit code (null if timed out/killed)
  stdout: string;                      // Captured stdout
  stderr: string;                      // Captured stderr
  duration_ms: number;                 // Wall clock execution time
  created_at: string;                  // ISO 8601
}
```

### CP Problems (competitive programming sessions only)

```
interface CpProblem {
  id: string;                          // UUID
  session_id: string;                  // FK → sessions (1:1 for CP sessions)
  judge: string;                       // 'codeforces' | 'atcoder' | 'leetcode' | 'other'
  problem_url: string;                 // Full URL to the problem page
  problem_id: string;                  // Judge-specific ID (e.g., "1900A", "abc350_d")
  problem_name: string;                // Problem title
  difficulty: string | null;           // Rating/difficulty if available (e.g., "1400", "D")
  topics: string[];                    // JSON array: "dp", "graphs", "number_theory", etc.
  verdict: 'unsolved' | 'accepted' | 'wrong_answer' | 'time_limit' | 'runtime_error' | 'attempted';
  attempts: number;                    // Number of submissions/local test runs
  solved_at: string | null;            // ISO 8601, null if unsolved
  editorial_notes: string;             // Markdown notes on the approach/solution
  created_at: string;
  updated_at: string;
}
```

### Test Cases (CP sessions)

```
interface TestCase {
  id: string;                          // UUID
  problem_id: string;                  // FK → cp_problems
  input: string;                       // Test input
  expected_output: string;             // Expected output
  is_sample: boolean;                  // true = from problem statement, false = custom
  created_at: string;
}
```

### Repo Explorations (repo sessions only)

```
interface RepoExploration {
  id: string;                          // UUID
  session_id: string;                  // FK → sessions (1:1 for repo sessions)
  repo_url: string;                    // GitHub URL
  repo_name: string;                   // "owner/repo"
  clone_path: string;                  // Relative path under data/repos/
  branch: string;                      // Branch checked out
  readme_summary: string;              // User's notes on what the repo does
  interesting_files: string[];         // JSON array of notable file paths
  created_at: string;
  updated_at: string;
}
```

### Cross-App Links

Sessions can link to entities in sibling apps for provenance tracking.

```
interface SessionLink {
  app: 'navigate' | 'scribe' | 'monolith' | 'granary';
  ref_type: 'arxiv_id' | 'paper_id' | 'note_id' | 'flowchart_node' | 'project' | 'entry_id';
  ref_id: string;                      // The foreign ID
  label?: string;                      // Human-readable display label
}
```

Typical flows:
* Reading a paper in Navigate → "try this" → creates a `freeform` session with `app: 'navigate', ref_type: 'arxiv_id'`
* Studying a textbook in Scribe → "try this" → creates a `freeform` session with `app: 'scribe', ref_type: 'flowchart_node'`
* Completing a session → log insight in Granary with `app: 'pyramid', ref_type: 'session_id'` (Granary side)

---

## Database Schema (`server/data/pyramid.db`)

SQLite database created at runtime. WAL mode, foreign keys enabled.

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  session_type TEXT NOT NULL DEFAULT 'freeform'
    CHECK (session_type IN ('freeform', 'cp', 'repo', 'lean')),
  language TEXT NOT NULL DEFAULT 'python',
  tags TEXT NOT NULL DEFAULT '[]',          -- JSON array of strings
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'completed', 'archived')),
  links TEXT NOT NULL DEFAULT '[]',         -- JSON array of SessionLink objects
  notes TEXT NOT NULL DEFAULT '',           -- Markdown+LaTeX session notes
  working_dir TEXT NOT NULL,               -- Relative path under data/sessions/
  created_at TEXT NOT NULL,                -- ISO 8601
  updated_at TEXT NOT NULL                 -- ISO 8601
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
  session_id TEXT NOT NULL UNIQUE,         -- 1:1 with session
  judge TEXT NOT NULL,
  problem_url TEXT NOT NULL,
  problem_id TEXT NOT NULL,
  problem_name TEXT NOT NULL DEFAULT '',
  difficulty TEXT,
  topics TEXT NOT NULL DEFAULT '[]',       -- JSON array of strings
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
  session_id TEXT NOT NULL UNIQUE,         -- 1:1 with session
  repo_url TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  clone_path TEXT NOT NULL,
  branch TEXT NOT NULL DEFAULT 'main',
  readme_summary TEXT NOT NULL DEFAULT '',
  interesting_files TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

**Indices:**

* `sessions.session_type` — for filtering by mode
* `sessions.status` — for listing active sessions
* `sessions.created_at` — for date-range queries
* `session_files.session_id` — FK lookup
* `execution_runs.session_id` — FK lookup
* `execution_runs.created_at` — for chronological run history
* `cp_problems.session_id` — FK lookup (UNIQUE)
* `cp_problems.judge` — for filtering by platform
* `cp_problems.verdict` — for progress tracking
* `test_cases.problem_id` — FK lookup
* `repo_explorations.session_id` — FK lookup (UNIQUE)

**JSON columns:** `tags`, `links`, `topics`, `interesting_files` are stored as JSON TEXT. Parse with `JSON.parse()` in route handlers, serialize with `JSON.stringify()` on write. Same pattern as Navigate and Granary.

### Full-Text Search (FTS5)

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
  title,
  notes,
  tags,
  content='sessions',
  content_rowid='rowid'
);
```

Sync via triggers (same pattern as Granary's `entries_fts`):

```sql
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
```

---

## API Endpoints

All under `/api` prefix. RESTful verbs. Parameterized SQL only — no string interpolation in queries.

### Sessions

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sessions` | List sessions. Query params: `session_type`, `status`, `language`, `tag`, `search` (FTS5). All filters combinable. Default sort: newest first. |
| GET | `/api/sessions/:id` | Get single session with associated files, problem (if CP), repo (if repo), and recent runs. |
| POST | `/api/sessions` | Create session. Body includes `session_type`, `title`, `language`, optional `links`. Auto-creates working directory. For CP sessions, also accepts `problem_url` to auto-fetch problem metadata and test cases via `oj`. |
| PUT | `/api/sessions/:id` | Update session metadata (title, tags, notes, status, links). |
| DELETE | `/api/sessions/:id` | Delete session, all associated data, and working directory. |
| PATCH | `/api/sessions/:id/status` | Update status. Body: `{ status: 'active' | 'paused' | 'completed' | 'archived' }`. |

### Session Files

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sessions/:id/files` | List files in a session. |
| GET | `/api/sessions/:id/files/:fileId` | Get file metadata. |
| GET | `/api/sessions/:id/files/:fileId/content` | Read file content from disk. |
| POST | `/api/sessions/:id/files` | Create a new file. Body: `{ filename, language, content, is_primary? }`. Writes to working directory. |
| PUT | `/api/sessions/:id/files/:fileId/content` | Update file content. Body: `{ content: string }`. |
| DELETE | `/api/sessions/:id/files/:fileId` | Delete file from DB and disk. |

### Execution

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sessions/:id/runs` | List execution runs for a session. Query params: `limit` (default 50). |
| POST | `/api/sessions/:id/execute` | Execute the primary file (or specify `file_id`). Spawns a child process, captures stdout/stderr, logs the run. Body: `{ file_id?, timeout_ms?, stdin? }`. |
| GET | `/api/sessions/:id/runs/:runId` | Get single run with full stdout/stderr. |

### CP Problems

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/cp/problems` | List all CP problems across sessions. Query params: `judge`, `verdict`, `topic`, `difficulty`. |
| GET | `/api/cp/problems/:id` | Get problem with test cases and session info. |
| PUT | `/api/cp/problems/:id` | Update problem metadata (topics, editorial_notes, verdict). |
| POST | `/api/cp/problems/:id/test` | Run solution against all test cases locally. Returns per-case results (pass/fail, actual output, time). |
| POST | `/api/cp/problems/:id/fetch-tests` | Re-fetch test cases from judge via `oj download`. |

### Test Cases

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/cp/problems/:id/tests` | List test cases for a problem. |
| POST | `/api/cp/problems/:id/tests` | Add a custom test case. Body: `{ input, expected_output }`. |
| DELETE | `/api/cp/problems/:id/tests/:testId` | Delete a test case. |

### Repo Explorations

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/repos` | List all repo explorations. |
| GET | `/api/repos/:id` | Get repo exploration with session info. |
| PUT | `/api/repos/:id` | Update repo metadata (readme_summary, interesting_files). |
| GET | `/api/repos/:id/tree` | List files/directories in the cloned repo (depth-limited). |
| GET | `/api/repos/:id/file?path=<path>` | Read a file from the cloned repo. |

### Stats

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/stats/overview` | Sessions by type, active count, total runs, CP solve rate. |
| GET | `/api/stats/heatmap` | Session activity (runs executed) by date. Query params: `start`, `end`. |
| GET | `/api/stats/cp` | CP progress: problems by verdict, by judge, by topic, solve rate over time. |
| GET | `/api/stats/languages` | Runs by language breakdown. |

### Settings

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings` | Get all settings. |
| GET | `/api/settings/:key` | Get single setting. |
| PUT | `/api/settings/:key` | Set a setting. Body: `{ value: string }`. |

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | `{ status: 'ok', timestamp: ... }` |

### Error Responses

HTTP status codes: 201 (created), 400 (bad input), 404 (not found), 409 (conflict/duplicate), 500 (server error). Error body: `{ error: 'descriptive message' }`. Every route handler wrapped in try-catch.

---

## Execution Service

The execution service (`server/src/services/execution.ts`) spawns child processes to run user code. Key design points:

* **Isolation:** Each session has its own working directory. Code runs with `cwd` set to that directory.
* **Timeout:** Default 30 seconds for freeform, 10 seconds for CP (configurable per-request). Processes killed with SIGTERM then SIGKILL after a 2-second grace period.
* **Capture:** stdout and stderr captured via pipe. Truncated to 1MB each to prevent DB bloat.
* **Language commands:**
  - Python: `python3 <file>`
  - Julia: `julia <file>`
  - C++: `g++ -O2 -std=c++17 -o a.out <file> && ./a.out` (compile + run in one step)
  - Lean: `lake env lean <file>` (requires Lean 4 + Lake in PATH)
* **stdin:** For CP testing, stdin is piped from the test case input.
* **No sandboxing:** This is a personal tool running locally. No containerization or syscall filtering. The user trusts their own code.

### OJ Integration

The `oj` service (`server/src/services/oj.ts`) wraps `online-judge-tools` for CP workflows:

* **Download test cases:** `oj download <problem_url>` — parses sample cases from the problem page, stores them as `TestCase` rows.
* **Local testing:** Runs the solution against each test case, comparing actual output to expected. Reports per-case pass/fail with diff.
* **Submission:** `oj submit <problem_url> <file>` — submits to the judge. Requires prior `oj login`. This is optional and may fail; the UI should degrade gracefully (offer "open in browser" fallback).
* **Prerequisite:** `pip install online-judge-tools` must be available in the server's environment. The server checks for `oj` availability on startup and sets a `oj_available` flag in settings.

---

## Client Views & Routing

| Path | Component | Description |
|------|-----------|-------------|
| `/` | `DashboardPage` | Overview: active sessions, recent runs, CP progress, activity heatmap |
| `/sessions` | `SessionListPage` | Browse/filter/search all sessions |
| `/sessions/new` | `NewSessionPage` | Create a new session (pick type, language, optional URL) |
| `/sessions/:id` | `SessionPage` | The main workbench: editor + output + notes |
| `/cp` | `CpPage` | CP-specific view: problem list, progress by topic, solve stats |
| `/repos` | `RepoListPage` | Browse repo explorations |

### DashboardPage (/)

* Active sessions count by type (prominent)
* Recent activity: last 10 execution runs across all sessions
* CP progress: problems solved this week/month, topic breakdown
* Activity heatmap (runs per day, same style as Scribe/Granary heatmaps)
* Quick-create buttons for each session type

### SessionListPage (/sessions)

* Filter by session_type, status, language, tag
* Full-text search across session titles and notes
* Each session shows: title, type badge, language, tag chips, last activity, status
* Click to open in SessionPage

### NewSessionPage (/sessions/new)

* **Freeform:** Pick language (Python/Julia/C++), optional title, optional cross-app links
* **CP:** Paste a problem URL → auto-detects judge, fetches problem name and test cases via `oj`. Pick language (Python/C++).
* **Repo:** Paste a GitHub repo URL → clones it, extracts README. Pick language for scratch files.
* **Lean:** Title only. Creates a `.lean` file.

### SessionPage (/sessions/:id)

The core workbench. Split-pane layout:

* **Left pane:** Code editor (CodeMirror 6). File tabs if multiple files. Syntax highlighting per language. For repo sessions, a file tree sidebar showing the cloned repo (read-only) alongside the user's scratch files (editable).
* **Right pane:** Tabbed panels:
  - **Output** — stdout/stderr from the latest run. Scrollable history of past runs.
  - **Notes** — Markdown+LaTeX editor for session notes. Auto-saved with 1500ms debounce (same as Scribe/Granary).
  - **Tests** (CP only) — Test case list. Run all / run single. Per-case pass/fail with expected vs actual diff.
  - **Problem** (CP only) — Problem statement display (if fetched). Verdict selector. Editorial notes editor.
  - **Repo** (repo only) — README display. Interesting files list. Repo metadata.
  - **Links** — Cross-app references. Add/remove links to Navigate papers, Scribe notes/flowchart nodes, Granary entries.
* **Toolbar:** Run button (executes primary file), language indicator, session status, timer showing session duration.

### CpPage (/cp)

* Problem table: judge, problem ID, name, difficulty, topics, verdict, attempts, date
* Filter by judge, verdict, topic
* Topic progress chart (how many solved per topic category)
* Links to individual session pages

### RepoListPage (/repos)

* List of explored repos with name, URL, clone date, summary
* Click to open the associated session

---

## Key Dependencies

**Frontend:** React 18, Vite 6, TypeScript 5, KaTeX 0.16 (for LaTeX in session notes), CodeMirror 6 (code editor with language modes for Python, C++, Julia, Lean), Recharts (dashboard charts), date-fns, uuid

**Backend:** Express 4, TypeScript 5, better-sqlite3 11+, cors, tsx (dev), child_process (Node.js built-in, for code execution)

**External tools (must be in PATH):**
* `python3` — for Python sessions
* `julia` — for Julia sessions (optional; sessions degrade if unavailable)
* `g++` — for C++ sessions
* `lean` + `lake` — for Lean sessions (optional)
* `oj` (online-judge-tools) — for CP test case fetching and submission (optional; CP mode works with manual test cases if `oj` is unavailable)
* `git` — for cloning repos in repo-exploration sessions

**Do NOT add:** Any web-based code execution service, any ORM, any state management library beyond React hooks + prop drilling from App.tsx (same as Navigate). No Jupyter kernel protocol — keep execution simple (spawn process, capture output).

---

## Conventions

### Code Style

Follow the exact conventions from Navigate, Scribe, and Granary:

* **TypeScript strict mode** in both client and server tsconfig
* **Naming:** camelCase for variables/functions, PascalCase for components/interfaces/types, snake_case for database columns and table names, UPPER_CASE for constants
* **Imports:** Named imports from libraries, relative paths for local files
* **No linter or formatter config** — follow existing code style in each file

### Component Structure

Same as Scribe and Granary:

* Each component in its own folder: `components/ComponentName/ComponentName.tsx` + `ComponentName.module.css`
* Pages: `pages/PageName/PageName.tsx` + `PageName.module.css`
* **CSS Modules** exclusively — no utility-class frameworks (no Tailwind)
* Design tokens as CSS custom properties in `global.css` under `:root` and `[data-theme="dark"]`

### Theming

Two themes: light (default) and dark. Same mechanism as Scribe and Granary:

* Toggle by setting `data-theme="dark"` on `document.documentElement`
* Persist to localStorage via a `themeStorage` service (key: `pyramid_theme`)
* Consume through a `ThemeContext`
* Use CSS custom properties from `global.css` everywhere — never hard-code colors

### Service Layer

Same pattern as Scribe and Granary:

* Services are **plain objects** (not classes) exported as `const serviceName = { ... }`
* Server-backed services are async, use `fetch()` to call the REST API
* Client-only services (theme, editor prefs) use localStorage and may be synchronous
* Services do NOT use React hooks
* Hooks wrap services and expose React state + callbacks

### Server Conventions

Same as Navigate, Scribe, and Granary:

* Routes in `server/src/routes/` — one file per resource
* Database schema and init in `server/src/db.ts`
* JSON columns stored as TEXT, parsed/serialized in route handlers
* CORS enabled (allows `*` origin) for LAN access from iPad and other devices
* Parameterized SQL only — no string interpolation in queries
* Route-level try-catch wrapping all handlers

### LaTeX Rendering

Use **KaTeX** for all math rendering in session notes. Same syntax as Scribe and Granary:

* Inline math: `$expression$` or `\(expression\)`
* Display math: `$$expression$$` or `\[expression\]`
* Use a shared `renderMarkdownWithLatex` utility component

### Date Handling

All dates stored in **CST (UTC-6, fixed offset)** — same convention as Scribe and Granary. Do not adjust for CDT.

### ID Generation

Use `crypto.randomUUID()` for all IDs. Same as Scribe and Granary.

---

## Testing

No test framework configured. Validate changes by running `npm run build` (runs `tsc` for both client and server, catching type errors).

---

## Adding a New Session Type

1. Add the value to the `session_type` CHECK constraint in `server/src/db.ts` (requires migration or rebuild)
2. Add to the `SessionType` union type in `client/src/types.ts`
3. Add a creation form variant in `NewSessionPage`
4. Add any type-specific tables (like `cp_problems` for CP) in `server/src/db.ts`
5. Add type-specific tabs/panels in `SessionPage`
6. Add type-specific routes in `server/src/routes/`

## Adding a New Language

1. Add the language to the execution service's command map in `server/src/services/execution.ts`
2. Add CodeMirror language mode import in the editor component
3. Add to the language selector in `NewSessionPage`
4. Verify the runtime is available on the server (add to startup checks)

## Adding a New API Endpoint

1. Create or edit a route file in `server/src/routes/`
2. Register the router in `server/src/index.ts` with `app.use('/api/...', router)`
3. If new tables are needed, add `CREATE TABLE IF NOT EXISTS` in `server/src/db.ts`

## Adding a New Page

1. Create `client/src/pages/NewPage/NewPage.tsx` and `NewPage.module.css`
2. Add a `<Route>` in `client/src/App.tsx`
3. Add a nav link in the layout component
