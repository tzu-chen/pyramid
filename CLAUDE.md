# Pyramid — CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

Pyramid is a **computational workbench** for **Lean 4 proof development** with full LSP integration and **freeform numerical/scientific computation** (Python/Julia/C++), accessible from any device including iPad. It includes built-in **Claude AI integration** for error diagnosis, formalization help, and implementation assistance. Sessions are the core abstraction — each session bundles code, outputs, notes, and provenance links into a logged, searchable unit.

The Lean experience is Pyramid's most distinctive feature: it provides an interactive proof development environment (editor + tactic goal state + diagnostics) served as a web app, enabling Lean work from any browser — including iPad — over the local network. No other tool provides this.

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
npm run dev:server        # Backend only (Express on port 3007, tsx watch for hot reload)
npm run dev:client        # Frontend only (Vite on port 5177)
npm run build             # Build both client and server for production
npm run build:client      # Build frontend only (tsc && vite build)
npm run build:server      # Build backend only (tsc)
npm start                 # Start production server (serves API + built frontend from client/dist/)
```

**Port assignment:** Pyramid uses port **3007** (server) and **5177** (Vite dev) to avoid conflicts with Navigate (3001/5173), Scribe (3003/5173), Monolith (3005/5173), and Granary (3009/5174). The Vite dev server proxies `/api` and `/ws` requests to `http://localhost:3007`.

No `.env` files. The only server environment variable is `PORT` (defaults to 3007).

---

## Architecture

Full-stack TypeScript: React 18 + Vite frontend, Express + SQLite backend. Same structure as Navigate, Scribe, and Granary, with additional WebSocket support for LSP communication.

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
│   │   ├── services/         # Data access layer (REST API calls + WebSocket client)
│   │   ├── hooks/            # Custom React hooks
│   │   └── contexts/         # React contexts (theme)
│   └── vite.config.ts        # Vite config with /api and /ws proxy to port 3007
└── server/                   # Express backend
    ├── src/
    │   ├── index.ts          # Express entry point, mounts route modules, WebSocket setup
    │   ├── db.ts             # SQLite schema init + migrations
    │   ├── routes/           # RESTful route handlers
    │   └── services/         # Business logic
    │       ├── execution.ts  # Child process spawning for Python/Julia/C++
    │       ├── lean-lsp.ts   # Lean LSP server lifecycle management
    │       ├── lean-project.ts # Lake project scaffolding and build
    │       ├── claude.ts     # Claude API client (Anthropic Messages API)
    │       ├── claude-prompts.ts # System prompts for Claude modes
    │       └── scribe.ts     # Scribe cross-app proxy client
    └── data/                 # Runtime data (gitignored)
        ├── pyramid.db        # SQLite database
        ├── sessions/         # Session working directories (code files, outputs)
        └── lean-projects/    # Lake projects (one per Lean session, with Mathlib cache)
```

---

## Lean 4 Integration (Primary Feature)

### Overview

Lean sessions provide an interactive proof development environment in the browser. The architecture:

1. **Lake project per session.** Each Lean session gets a proper Lake project directory under `data/lean-projects/<session_id>/` with `lakefile.toml`, `lean-toolchain`, and Mathlib as a dependency. This is scaffolded automatically on session creation.

2. **Lean LSP server per session.** When a Lean session is opened, the backend spawns a `lean --server` process (the Lean Language Server) attached to the session's Lake project. The LSP process is long-lived — it stays running as long as the session is active in the browser.

3. **WebSocket bridge.** The backend proxies LSP JSON-RPC messages between the browser client and the Lean LSP server over a WebSocket connection. The client sends editor changes and cursor positions; the server relays them to the LSP and forwards responses (goal state, diagnostics, completions) back to the client.

4. **Goal state panel.** The client renders the Lean goal state (from `Lean/plainGoal` or `Lean/plainTermGoal` requests) in a dedicated panel, updating on every cursor movement. Math content is rendered with KaTeX.

5. **Multi-device access.** Because the LSP server runs on the backend machine, any device on the LAN (including iPad) gets the full interactive Lean experience through the browser. This is the primary motivation for building Lean support into Pyramid rather than relying on VSCode.

### Lake Project Scaffolding

The `lean-project` service (`server/src/services/lean-project.ts`) handles project lifecycle:

**Creation:** When a Lean session is created, the service:

1. Creates `data/lean-projects/<session_id>/`
2. Writes `lakefile.toml`:
   ```toml
   [package]
   name = "pyramid-session"
   leanOptions = [{ name = "autoImplicit", value = false }]

   [[require]]
   name = "mathlib"
   scope = "leanprover-community"
   ```
3. Writes `lean-toolchain` pinned to the Mathlib-compatible Lean version
4. Runs `lake exe cache get` to download prebuilt Mathlib `.olean` files (cached globally — see Mathlib Cache below)
5. Creates the initial `.lean` file (e.g., `Main.lean`) with a starter import

**Mathlib cache:** Mathlib prebuilt artifacts are large (~5GB). To avoid re-downloading per session, use a shared cache directory. Set `MATHLIB_CACHE_DIR` or symlink `~/.elan` and `~/.cache/mathlib` so all Lake projects share the same downloaded oleans. The first Lean session creation triggers the download; subsequent sessions reuse the cache.

**Build:** `lake build` compiles the project. The service runs this on demand (when the user explicitly builds) and captures output. For incremental checking, the LSP server handles file-level re-elaboration automatically — a full `lake build` is only needed for final verification.

### Lean LSP Service

The `lean-lsp` service (`server/src/services/lean-lsp.ts`) manages Lean Language Server processes:

**Lifecycle:**

* **Start:** Spawns `lean --server` with `cwd` set to the session's Lake project directory. The process communicates via stdin/stdout using the LSP JSON-RPC protocol.
* **Stop:** Sends LSP `shutdown` + `exit` when the session is closed or the user navigates away. Processes are also killed on server shutdown.
* **Idle timeout:** If no WebSocket messages are received for 30 minutes, the LSP process is stopped to conserve resources. It restarts transparently when the user returns.

**Message routing:**

* Client → Server: The browser sends LSP requests/notifications over WebSocket. The backend validates the JSON-RPC structure and forwards to the Lean process's stdin.
* Server → Client: The backend reads Lean's stdout, parses JSON-RPC messages, and forwards to the browser over WebSocket.
* The backend does NOT interpret LSP messages beyond basic routing (no caching, no transformation). It is a transparent proxy.

**Key LSP features to support (in priority order):**

1. `textDocument/didOpen`, `textDocument/didChange` — keep the LSP server in sync with editor content
2. `textDocument/publishDiagnostics` — errors and warnings, displayed inline in the editor
3. `Lean/plainGoal` — tactic goal state at cursor position, displayed in the Goal State panel
4. `textDocument/completion` — auto-completion (Mathlib names, tactics)
5. `textDocument/hover` — type information on hover
6. `textDocument/definition` — go-to-definition (navigate to Mathlib source)

Items 1–3 are the MVP. Items 4–6 are enhancements.

### WebSocket Protocol

The server exposes a WebSocket endpoint for LSP communication:

```
WebSocket: ws://localhost:3007/ws/lean/:sessionId
```

**Connection lifecycle:**

1. Client connects to `/ws/lean/<sessionId>`
2. Server checks if a Lean LSP process exists for this session; starts one if not
3. Client sends `initialize` LSP request; server forwards to Lean, relays response
4. Bidirectional JSON-RPC message relay until disconnect
5. On disconnect, idle timeout begins (30 min); after timeout, LSP process is stopped

**Message format:** Raw LSP JSON-RPC over WebSocket text frames. The client is responsible for constructing valid LSP messages. Example:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}
{"jsonrpc":"2.0","method":"textDocument/didOpen","params":{...}}
{"jsonrpc":"2.0","id":2,"method":"Lean/plainGoal","params":{"textDocument":{"uri":"file:///..."},"position":{"line":10,"character":4}}}
```

### Client-Side Lean UI

The `SessionPage` for Lean sessions has a specialized layout:

* **Left pane: Editor** — CodeMirror 6 with Lean 4 syntax highlighting. File tabs for multi-file projects. Unicode input support (e.g., `\forall` → `∀`, `\R` → `ℝ`, `\lam` → `λ`). Inline diagnostics (red/yellow squiggles from `publishDiagnostics`).

* **Right pane: Goal State** (primary tab) — Renders the tactic goal state returned by `Lean/plainGoal`. Updates on every cursor position change within a `by` tactic block. Rendered with KaTeX for mathematical content. Shows "No goals" when the cursor is outside a tactic proof, or "Proof complete ✓" when all goals are closed.

* **Right pane: Messages** tab — Lean info messages (`#check`, `#eval`, `#print` output). Separate from diagnostics.

* **Right pane: Notes** tab — Markdown+LaTeX session notes (same as other session types).

* **Right pane: Links** tab — Cross-app references (same as other session types).

* **Toolbar:** Build button (runs `lake build`), file selector, session status, link to Scribe/Navigate provenance.

### Lean-Specific Session Data

Lean sessions store additional metadata beyond the base `Session` type:

```
interface LeanSessionMeta {
  id: string;                          // UUID
  session_id: string;                  // FK → sessions (1:1)
  lean_version: string;               // e.g., "leanprover/lean4:v4.16.0"
  mathlib_version: string;            // Git SHA or tag of Mathlib dependency
  project_path: string;               // Relative path under data/lean-projects/
  lake_status: 'initializing' | 'ready' | 'building' | 'error';
  last_build_output: string;          // stdout+stderr from last lake build
  last_build_at: string | null;       // ISO 8601
  created_at: string;
  updated_at: string;
}
```

---

## Other Session Types

### Freeform (Python/Julia/C++)

Open-ended numerical/scientific experimentation. The user writes code, runs it, observes results. Used for SPDE simulations, ML experiments, algorithm exploration.

Execution model: spawn a child process (`python3`, `julia`, or `g++ && ./a.out`), capture stdout/stderr, log the run. Simple spawn-and-exit, no long-lived process.

---

## Core Concepts

### Sessions

The fundamental data unit. A session is a timestamped workspace for a specific activity.

```
interface Session {
  id: string;                          // UUID
  title: string;                       // User-provided or auto-generated
  session_type: 'lean' | 'freeform';
  language: string;                    // 'lean' | 'python' | 'julia' | 'cpp'
  tags: string[];                      // JSON array stored as TEXT
  status: 'active' | 'paused' | 'completed' | 'archived';
  links: SessionLink[];                // Cross-app references (see below)
  notes: string;                       // Markdown+LaTeX session notes
  working_dir: string;                 // Relative path under data/sessions/ or data/lean-projects/
  created_at: string;                  // ISO 8601
  updated_at: string;                  // ISO 8601
}
```

### Session Files

```
interface SessionFile {
  id: string;                          // UUID
  session_id: string;                  // FK → sessions
  filename: string;                    // e.g., "Main.lean", "main.py", "solution.cpp"
  file_type: 'source' | 'output' | 'plot' | 'data' | 'other';
  language: string;                    // File language for syntax highlighting
  is_primary: boolean;                 // The "main" file to execute/check
  created_at: string;
  updated_at: string;
}
```

File content is stored on the filesystem, not in SQLite. The `session_files` table stores metadata only.

### Execution Runs (freeform only)

```
interface ExecutionRun {
  id: string;                          // UUID
  session_id: string;                  // FK → sessions
  file_id: string;                     // FK → session_files
  command: string;                     // e.g., "python3 main.py"
  exit_code: number | null;            // null if timed out/killed
  stdout: string;
  stderr: string;
  duration_ms: number;
  created_at: string;                  // ISO 8601
}
```

### Cross-App Links

```
interface SessionLink {
  app: 'navigate' | 'scribe' | 'monolith' | 'granary';
  ref_type: 'arxiv_id' | 'paper_id' | 'note_id' | 'flowchart_node' | 'project' | 'entry_id';
  ref_id: string;
  label?: string;
}
```

Typical flows:
* Reading a paper in Navigate → "try this" → creates a `lean` or `freeform` session with `app: 'navigate', ref_type: 'arxiv_id'`
* Studying a textbook in Scribe → "formalize this" → creates a `lean` session with `app: 'scribe', ref_type: 'flowchart_node'`
* Completing a session → log insight in Granary with `app: 'pyramid', ref_type: 'session_id'` (Granary side)

---

## Database Schema (`server/data/pyramid.db`)

SQLite database created at runtime. WAL mode, foreign keys enabled.

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  session_type TEXT NOT NULL DEFAULT 'lean'
    CHECK (session_type IN ('lean', 'freeform')),
  language TEXT NOT NULL DEFAULT 'lean',
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

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

**Indices:**

* `sessions.session_type`, `sessions.status`, `sessions.created_at`
* `session_files.session_id`
* `lean_session_meta.session_id` (UNIQUE)
* `execution_runs.session_id`, `execution_runs.created_at`

**JSON columns:** `tags`, `links` stored as JSON TEXT. Parse/serialize in route handlers. Same pattern as Navigate and Granary.

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

All under `/api` prefix. RESTful verbs. Parameterized SQL only.

### Sessions

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sessions` | List sessions. Query params: `session_type`, `status`, `language`, `tag`, `search` (FTS5). |
| GET | `/api/sessions/:id` | Get single session with files, type-specific data, and recent runs. |
| POST | `/api/sessions` | Create session. For `lean`: scaffolds Lake project, runs `lake exe cache get`. |
| PUT | `/api/sessions/:id` | Update session metadata (title, tags, notes, status, links). |
| DELETE | `/api/sessions/:id` | Delete session, all associated data, and working directory. |
| PATCH | `/api/sessions/:id/status` | Update status. |

### Session Files

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sessions/:id/files` | List files in a session. |
| GET | `/api/sessions/:id/files/:fileId/content` | Read file content from disk. |
| POST | `/api/sessions/:id/files` | Create a new file. Body: `{ filename, language, content, is_primary? }`. |
| PUT | `/api/sessions/:id/files/:fileId/content` | Update file content. Body: `{ content: string }`. |
| DELETE | `/api/sessions/:id/files/:fileId` | Delete file from DB and disk. |

### Lean-Specific

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/lean/:sessionId/meta` | Get Lean session metadata (versions, lake status, last build). |
| POST | `/api/lean/:sessionId/build` | Trigger `lake build`. Streams output via WebSocket or returns on completion. |
| GET | `/api/lean/:sessionId/build-output` | Get last build stdout/stderr. |
| WS | `/ws/lean/:sessionId` | WebSocket endpoint for LSP message relay. |

### Execution (freeform only)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sessions/:id/runs` | List execution runs. Query params: `limit` (default 50). |
| POST | `/api/sessions/:id/execute` | Execute file. Body: `{ file_id?, timeout_ms?, stdin? }`. |
| GET | `/api/sessions/:id/runs/:runId` | Get single run with full output. |

### Claude AI

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/sessions/:id/claude/ask` | Send prompt with context to Claude. Body: `{ prompt, context: [{label, content}], mode }`. |

### Scribe Proxy

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/scribe/flowcharts` | List Scribe flowcharts (proxied to Scribe at port 3003). |
| GET | `/api/scribe/nodes/search?title=<query>` | Search Scribe nodes by title. |
| GET | `/api/scribe/nodes/:flowchartId/:nodeKey` | Get a specific Scribe node. |

### Stats

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/stats/overview` | Sessions by type, active count, total runs. |
| GET | `/api/stats/heatmap` | Activity by date. Query params: `start`, `end`. |
| GET | `/api/stats/languages` | Runs by language. |

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

## Execution Service (freeform)

The execution service (`server/src/services/execution.ts`) spawns child processes for freeform sessions:

* **Isolation:** Each session has its own working directory. Code runs with `cwd` set to that directory.
* **Timeout:** Default 30 seconds. Processes killed with SIGTERM then SIGKILL after 2-second grace period.
* **Capture:** stdout and stderr captured via pipe. Truncated to 1MB each.
* **Language commands:**
  - Python: `python3 <file>`
  - Julia: `julia <file>`
  - C++: `g++ -O2 -std=c++17 -o a.out <file> && ./a.out`
* **No sandboxing:** Personal tool running locally.

---

## Client Views & Routing

| Path | Component | Description |
|------|-----------|-------------|
| `/` | `DashboardPage` | Overview: active sessions, recent activity, heatmap |
| `/sessions` | `SessionListPage` | Browse/filter/search all sessions |
| `/sessions/new` | `NewSessionPage` | Create session (pick type, language) |
| `/sessions/:id` | `SessionPage` | The main workbench (layout varies by session type) |

### SessionPage (/sessions/:id) — Lean Mode

Split-pane layout:

* **Left pane: Editor** — CodeMirror 6 with Lean 4 syntax highlighting, Unicode input, inline diagnostics. File tabs for multi-file projects.
* **Right pane tabs:**
  - **Goal State** (default) — tactic goal state from `Lean/plainGoal`, updated on cursor move. Rendered with KaTeX. Shows "No goals" outside tactic blocks, "Proof complete ✓" when done.
  - **Messages** — Lean info messages (`#check`, `#eval`, `#print` output).
  - **Claude** — AI assistant panel with context auto-assembly, mode selection, and response rendering.
  - **Notes** — Markdown+LaTeX session notes. Auto-saved with 1500ms debounce.
  - **Links** — Cross-app references with add/remove management.
* **Toolbar:** Build button (`lake build`), lake status indicator, session status. "Ask Claude" button appears when error diagnostics are present.

### SessionPage (/sessions/:id) — Freeform Mode

Split-pane layout:

* **Left pane: Editor** — CodeMirror 6 with language-appropriate syntax highlighting. File tabs.
* **Right pane tabs:**
  - **Output** — stdout/stderr from latest run. Scrollable run history.
  - **Claude** — AI assistant panel with context auto-assembly, mode selection, and response rendering.
  - **Notes** — Markdown+LaTeX session notes.
  - **Links** — Cross-app references with add/remove management.
* **Toolbar:** Run button, language indicator, session status. "Ask Claude" button appears when a run fails.

---

## Key Dependencies

**Frontend:** React 18, Vite 6, TypeScript 5, KaTeX 0.16 (LaTeX rendering in goal state and notes), CodeMirror 6 (code editor — needs `@codemirror/lang-lean4` or custom Lean mode + Unicode input extension), Recharts (dashboard charts), date-fns, uuid

**Backend:** Express 4, TypeScript 5, better-sqlite3 11+, ws (WebSocket library for LSP bridge), cors, tsx (dev), child_process (Node.js built-in)

**External tools (must be in PATH):**
* `lean` — Lean 4 (via elan toolchain manager). Required for Lean sessions.
* `lake` — Lake build system (bundled with Lean). Required for Lean sessions.
* `python3` — for Python sessions
* `julia` — for Julia sessions (optional)
* `g++` — for C++ sessions
* `git` — for Lake/Mathlib dependency management

**Do NOT add:** Any ORM, any state management library beyond React hooks + prop drilling from App.tsx. No Jupyter kernel protocol. No LSP client library on the frontend — implement the minimal LSP JSON-RPC client directly (it's just JSON over WebSocket).

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
* **CSS Modules** exclusively — no Tailwind
* Design tokens as CSS custom properties in `global.css` under `:root` and `[data-theme="dark"]`

### Theming

Two themes: light (default) and dark. Same mechanism as Scribe and Granary:

* Toggle by setting `data-theme="dark"` on `document.documentElement`
* Persist to localStorage (key: `pyramid_theme`)
* Consume through `ThemeContext`
* Use CSS custom properties everywhere

### Service Layer

Same pattern as Scribe and Granary:

* Services are **plain objects** (not classes) exported as `const serviceName = { ... }`
* Server-backed services are async, use `fetch()` for REST, `WebSocket` for LSP
* Client-only services (theme, editor prefs) use localStorage
* Services do NOT use React hooks; hooks wrap services

### Server Conventions

* Routes in `server/src/routes/` — one file per resource
* Database schema and init in `server/src/db.ts`
* JSON columns stored as TEXT, parsed/serialized in route handlers
* CORS enabled (`*` origin) for LAN access from iPad and other devices
* Parameterized SQL only
* Route-level try-catch wrapping

### LaTeX Rendering

**KaTeX** for all math rendering (session notes, goal state panel). Same syntax as Scribe and Granary.

### Date Handling

**CST (UTC-6, fixed offset)** — same convention as Scribe and Granary.

### ID Generation

`crypto.randomUUID()` for all IDs.

---

## Claude API Integration

Pyramid integrates with the Anthropic Claude API for AI-assisted coding and proof development.

### API Key Management

The API key is stored in the `settings` table (key: `claude_api_key`). Users configure it via the Settings modal (gear icon in sidebar). The key is never exposed to the client — it is read server-side when making API calls.

### Ask Endpoint

```
POST /api/sessions/:id/claude/ask
Body: { prompt: string, context: Array<{label, content}>, mode: ClaudeMode }
Response: { response: string, input_tokens: number, output_tokens: number }
```

The server reads the API key from settings, builds a system prompt based on the mode, assembles the context blocks into the user message, and calls the Anthropic Messages API (`claude-sonnet-4-20250514`).

### System Prompt Modes

Defined in `server/src/services/claude-prompts.ts`:

| Mode | Description |
|------|-------------|
| `error_diagnosis` | Analyzes errors (Lean diagnostics or runtime errors). Separate prompts for Lean vs freeform. |
| `formalization_help` | Helps translate informal math into Lean 4 proofs. Lean sessions only. |
| `implementation_help` | Helps implement algorithms/methods. Freeform sessions only. |
| `general` | Open-ended coding assistant. |

### Context Auto-Assembly (Client)

The `ClaudePanel` component (`client/src/components/ClaudePanel/ClaudePanel.tsx`) automatically assembles context:

1. **Current file** — always included
2. **Diagnostics** (Lean) — LSP error/warning messages
3. **Goal state** (Lean) — current tactic goal
4. **Last run output** (freeform) — stdout/stderr from failed runs
5. **Scribe nodes** — fetched from linked Scribe flowchart nodes

Users can also manually add Scribe nodes via a search picker.

### Scribe Proxy

Routes in `server/src/routes/scribe-proxy.ts` proxy requests to Scribe at `http://localhost:3003` with a 3-second timeout. Graceful degradation: if Scribe is not running, endpoints return empty results instead of errors.

---

## Testing

No test framework configured. Validate changes by running `npm run build`.

---

## Adding a New Session Type

1. Add to `session_type` CHECK constraint in `server/src/db.ts`
2. Add to `SessionType` union in `client/src/types.ts`
3. Add creation form variant in `NewSessionPage`
4. Add type-specific tables in `server/src/db.ts` if needed
5. Add type-specific tabs/panels in `SessionPage`
6. Add type-specific routes in `server/src/routes/`

## Adding a New Language (freeform)

1. Add to execution service command map in `server/src/services/execution.ts`
2. Add CodeMirror language mode in editor component
3. Add to language selector in `NewSessionPage`
4. Verify runtime availability (add startup check)

## Adding a New API Endpoint

1. Create or edit route file in `server/src/routes/`
2. Register in `server/src/index.ts`
3. Add tables in `server/src/db.ts` if needed

## Adding a New Page

1. Create `client/src/pages/NewPage/NewPage.tsx` + `NewPage.module.css`
2. Add `<Route>` in `client/src/App.tsx`
3. Add nav link in layout component
