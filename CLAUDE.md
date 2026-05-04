# Pyramid — CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

Pyramid is a **computational workbench** for **Lean 4 proof development**, **freeform numerical/scientific computation** (Python/Julia/C++ with full clangd/CMake support for C++), and **Jupyter-style notebooks**, accessible from any device including iPad. It includes built-in **Claude AI integration** for error diagnosis, formalization help, and implementation assistance. Sessions are the core abstraction — each session bundles code, outputs, notes, and provenance links into a logged, searchable unit.

The Lean experience and the C++ experience are Pyramid's two most distinctive features. Both are built on the same generic **LSP bridge** (`lsp-bridge.ts`): the backend spawns a language server (`lean --server` or `clangd`) per session and proxies LSP JSON-RPC over WebSocket. C++ sessions additionally get a CMake-aware build/run pipeline, build artifact browser, document outline, and Compiler Explorer integration.

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
npm run build:server      # Build backend only (tsc; copies jupyter-bridge.py into dist/)
npm start                 # Start production server (serves API + built frontend from client/dist/)
```

**Port assignment:** Pyramid uses port **3007** (server) and **5177** (Vite dev) to avoid conflicts with Navigate (3001/5173), Scribe (3003/5173), Monolith (3005/5173), and Granary (3009/5174). The Vite dev server proxies `/api` and `/ws` requests to `http://localhost:3007`.

No `.env` files. The only server environment variable is `PORT` (defaults to 3007).

---

## Architecture

Full-stack TypeScript: React 18 + Vite frontend, Express + SQLite backend. Same structure as Navigate, Scribe, and Granary, with additional WebSocket support for LSP, Jupyter kernels, and PTY-backed terminals.

```
pyramid/
├── package.json
├── client/src/
│   ├── main.tsx, App.tsx, types.ts, styles/global.css
│   ├── components/   # ArtifactBrowser, BuildPanel, ClaudePanel, CodeEditor (CodeMirror 6 + LSP),
│   │                 # CompilerExplorerPanel, CsvViewer, FileTree, GoalStatePanel,
│   │                 # NotebookEditor, OutlinePanel, SettingsModal, SymbolPalette, TerminalPane
│   ├── pages/        # Dashboard, SessionList, NewSession, SessionPage
│   ├── services/     # REST + WebSocket clients
│   ├── hooks/        # useLeanLsp, useCppLsp, useNotebookKernel, useTerminal, useSession, ...
│   └── contexts/     # Theme, editor font size
│   (vite.config.ts proxies /api and /ws to port 3007)
└── server/src/
    ├── index.ts      # Express entry, route mounts, WebSocket upgrade routing
    ├── db.ts         # SQLite schema + migrations
    ├── routes/       # RESTful route handlers (one file per resource)
    └── services/
        ├── lsp-bridge.ts       # Generic LSP-over-WebSocket relay (lifecycle, framing, idle timeout, init caching)
        ├── lean-lsp.ts         # Thin wrapper: spawns `lean --server` via lsp-bridge
        ├── lean-project.ts     # Lake project scaffolding and build
        ├── cpp-lsp.ts          # Thin wrapper: spawns `clangd` via lsp-bridge
        ├── cpp-project.ts      # Drops default `.clangd` into freeform C++ sessions
        ├── cpp-build.ts        # CMake configure/build/run, diagnostic parser, artifact tree
        ├── execution.ts        # Single-file Python/Julia/C++ child process runner
        ├── notebook-kernel.ts  # Jupyter kernel lifecycle + WS relay (via jupyter-bridge.py)
        ├── jupyter-bridge.py   # Python sidecar driving ipykernel; speaks JSON-lines on stdio
        ├── terminal.ts         # node-pty shell sessions for freeform sessions
        ├── godbolt.ts          # Compiler Explorer REST client + compiler list cache
        ├── claude.ts           # Claude API client (Anthropic Messages API)
        ├── claude-prompts.ts   # System prompts for Claude modes
        └── scribe.ts           # Scribe cross-app proxy client
    (data/ holds pyramid.db, sessions/, lean-projects/ — gitignored)
```

### LSP Bridge (`lsp-bridge.ts`)

A single generic class `LspBridge` runs every LSP server Pyramid talks to. It owns:

* **Process lifecycle.** `start(sessionId, config)` spawns the LSP binary with the configured `cwd`/`args`/`env`. Idempotent — repeated `start` returns the existing process.
* **LSP framing.** Reads `Content-Length` framed JSON-RPC from the server's stdout, writes framed messages to its stdin.
* **WebSocket fan-out.** `handleWebSocket(ws, sessionId, config)` attaches a browser client. Multiple clients per session are supported (server messages broadcast to all). Idle timeout (default 30 minutes) starts when the last client disconnects; force-stop on shutdown.
* **Initialize caching.** The first `initialize` request is forwarded to the LSP server; the response is cached. Reconnecting clients receive the cached result instead of triggering a duplicate initialize (which would crash most LSP servers). The `initialized` notification is forwarded exactly once.

`lean-lsp.ts` and `cpp-lsp.ts` are ~30-line files that just export a `handleWebSocket` that calls into the shared bridge with their command and args. **All shared LSP behavior lives in `lsp-bridge.ts`.** When adding a new language server, write another thin wrapper rather than reimplementing the bridge.

---

## Lean 4 Integration

### Overview

Lean sessions provide an interactive proof development environment in the browser. The architecture:

1. **Lake project per session.** Each Lean session gets a proper Lake project under `data/lean-projects/<session_id>/` with `lakefile.toml`, `lean-toolchain`, and Mathlib as a dependency. Scaffolded automatically on session creation by `lean-project.ts`.
2. **Lean LSP server per session.** `cpp-lsp.ts`-style wrapper spawns `lean --server` for the session's project and hands the WebSocket off to `LspBridge`. Long-lived; survives client reconnects.
3. **WebSocket bridge.** Browser ↔ backend over `/ws/lean/:sessionId`; backend ↔ LSP over stdio. Transparent JSON-RPC relay (no transformation beyond `initialize` caching).
4. **Goal state panel.** Renders the Lean tactic goal state from `$/lean/plainGoal` requests. Math content rendered with KaTeX. (Note: Lean 4 uses the `$/lean/plainGoal` method name, not `Lean/plainGoal`.)
5. **Multi-device access.** Because the LSP server runs on the backend, any device on the LAN (including iPad) gets the full interactive experience through the browser.

### Lake Project Scaffolding

`lean-project.ts` handles project lifecycle:

**Creation:** when a Lean session is created, the service:

1. Creates `data/lean-projects/<session_id>/`
2. Writes `lakefile.toml` with Mathlib as a dependency
3. Writes `lean-toolchain` pinned to a Mathlib-compatible Lean version
4. Runs `lake exe cache get` to download prebuilt Mathlib `.olean` files
5. Creates an initial `Main.lean` with a starter import

Scaffolding runs **in the background** after the session row is inserted; the `lake_status` field on `lean_session_meta` reflects progress (`initializing` → `ready` / `error`).

**Mathlib cache:** Mathlib prebuilt artifacts are large (~5GB). Use a shared cache to avoid re-downloading per session — set `MATHLIB_CACHE_DIR` or symlink `~/.elan` and `~/.cache/mathlib`.

**Build:** `lake build` compiles the project. The LSP server handles incremental file-level re-elaboration; an explicit `lake build` is only needed for final verification or when the user clicks the Build button.

### Key LSP features

The bridge is transparent, so any LSP method works as long as the client requests it. The client currently relies on:

1. `textDocument/didOpen`, `textDocument/didChange` — keep the LSP in sync with editor content
2. `textDocument/publishDiagnostics` — errors/warnings displayed inline in the editor
3. `$/lean/plainGoal` — tactic goal state at cursor; rendered in the Goal State panel
4. `textDocument/completion` — Mathlib + tactic completions
5. `textDocument/hover` — type information

### WebSocket Protocol

```
WebSocket: ws://localhost:3007/ws/lean/:sessionId
```

Connection lifecycle:

1. Client connects to `/ws/lean/<sessionId>`
2. Server validates that `lean_session_meta` exists for this session (otherwise socket destroyed)
3. Server starts a `lean --server` process via `LspBridge` if one isn't already running for this session
4. Client sends `initialize`; bridge forwards to Lean (or returns cached result on reconnect)
5. Bidirectional JSON-RPC relay until disconnect
6. After last client disconnects, idle timer starts (30 min); on expiry, the LSP process is shut down cleanly

### Lean-Specific Session Data

```
interface LeanSessionMeta {
  id: string;
  session_id: string;                  // FK → sessions (1:1)
  lean_version: string;
  mathlib_version: string;
  project_path: string;                // Relative path under data/lean-projects/
  lake_status: 'initializing' | 'ready' | 'building' | 'error';
  last_build_output: string;
  last_build_at: string | null;
  created_at: string;
  updated_at: string;
}
```

---

## C++ Integration

C++ is a first-class session type. Two modes coexist in a single freeform C++ session:

* **Single-file mode** — backed by `executeFile` in `execution.ts`. Compiles and runs `g++ -O2 -std=c++20 -Wall -Wextra -o a.out <file> && ./a.out`. Used when the session has no `CMakeLists.txt`.
* **CMake project mode** — backed by `cpp-build.ts`. Activated automatically when `CMakeLists.txt` exists in the session root. Configure → build → run pipeline with build flavors, sanitizers, parsed diagnostics, and artifact browsing.

The mode is decided per-execute by `isCmakeProject()` (just `existsSync(<dir>/CMakeLists.txt)`), so a session can be promoted from single-file to CMake by simply adding a `CMakeLists.txt`.

### clangd LSP

Every freeform C++ session gets a clangd LSP server.

* **Wrapper:** `cpp-lsp.ts` — spawns `clangd` with: `--background-index --clang-tidy --header-insertion=never --completion-style=detailed --pch-storage=memory --log=error`.
* **Bootstrap config:** `cpp-project.ts` drops a default `.clangd` at the session root on session creation **and** every WebSocket connect (idempotent, so old sessions get one when reopened). The config sets `-std=c++20 -Wall -Wextra -Wpedantic -Wshadow`, points at `g++` for system headers, and enables `modernize-* / performance-* / bugprone-* / readability-*` clang-tidy checks.
* **CMake integration:** when CMake configures a project, `cpp-build.ts` symlinks `build/<flavor>/compile_commands.json` to the project root so clangd picks up real per-file flags. (Falls back to copy if the filesystem doesn't support symlinks.)
* **Document symbols:** the client requests `textDocument/documentSymbol`; results render in `OutlinePanel` as a tree (functions, classes, namespaces, ...).

### CMake Build Pipeline (`cpp-build.ts`)

A small wrapper around the `cmake` binary with structured output.

* **Build flavors** — `BuildType` ∈ {`Debug`, `Release`, `RelWithDebInfo`, `MinSizeRel`} combined with optional `Sanitizer[]` ∈ {`asan`, `tsan`, `ubsan`, `msan`}. Combinations are validated (tsan can't combine with asan/msan; asan can't combine with msan; no duplicates). The flavor maps to a directory name like `Debug-asan-ubsan` under `build/`, so multiple flavors coexist.
* **Generator detection** — uses Ninja if it's on `PATH`, otherwise lets cmake pick (Make on Linux).
* **Configure** — `cmake -S <dir> -B <buildDir> -DCMAKE_BUILD_TYPE=<type> -DCMAKE_EXPORT_COMPILE_COMMANDS=ON [-DCMAKE_CXX_FLAGS=<sanitizer flags>]`. Caches: if `CMakeCache.txt` and `compile_commands.json` already exist, returns immediately unless `reconfigure: true`.
* **Build** — `cmake --build <buildDir> -j<cpus> [--target <target>]`. ANSI color stripped from output (`CLICOLOR_FORCE=0`, `CMAKE_COLOR_DIAGNOSTICS=OFF`) to keep parsed diagnostics clean.
* **Diagnostic parser** — a regex over GCC/Clang output (`file:line:col: severity: message`) producing structured `CompilerDiagnostic[]` with normalized relative paths. `fatal error` collapses to `error`. Continuation lines fold into the most recent diagnostic until a blank line.
* **Run** — picks the produced binary (by name if `target` is specified, else first executable under `build/<flavor>/`) and runs it with optional `args`/`stdin`/`timeoutMs` (default 30s). SIGTERM with 2-second SIGKILL grace.
* **Build persistence** — every `ensureBuilt` call inserts a `builds` row plus one `build_diagnostics` row per diagnostic. Successful runs additionally set `execution_runs.build_id` / `binary_path` / `flavor`.
* **Cleanup** — `cleanFlavor` removes one `build/<flavor>/`; `cleanAll` removes the entire `build/` directory and any `compile_commands.json` symlink.

### Build Artifact Browser

`cpp-build.ts` exposes a tree view of `build/`:

* **Classification** — files are tagged `executable` / `object` / `archive` / `shared_lib` / `compile_commands` / `cmake` / `text` / `binary` / `dir` based on extension and the executable bit.
* **Limits** — at most 4000 entries walked; symlinks skipped to avoid escaping the build dir.
* **Read** — `readArtifactText` returns up to 512 KB of text content; pretty-prints `compile_commands.json` when reading the canonical file.
* **Download** — `download` endpoint streams arbitrary binaries with `Content-Disposition: attachment`.
* **Path safety** — `resolveArtifactPath` rejects `..`, absolute paths, NUL bytes, and paths with > 32 segments.

### Compiler Explorer (godbolt.org)

`godbolt.ts` is a thin REST client for the public Compiler Explorer API. Used from the `CompilerExplorerPanel` to inspect generated assembly for a region of source.

* `GET /api/godbolt/compilers?lang=c++` — list compilers (cached for 6h to avoid hammering the upstream).
* `POST /api/godbolt/compile` — body `{ compilerId, source, userArguments?, filters? }`. 256 KB source cap, 20s upstream timeout. Returns the raw godbolt response (`code`, `asm[]`, `stdout[]`, `stderr[]`, ...).

This is the only feature in Pyramid that calls an external network service. If offline, the panel surfaces the error gracefully; nothing else breaks.

---

## Notebook Sessions

Jupyter-style cell-by-cell Python execution.

* **Storage** — single `.ipynb` file in the session working dir; `NotebookEditor` edits it as JSON, server writes via the file content endpoint. No special schema beyond `session_files`.
* **Kernel bridge** — `notebook-kernel.ts` spawns one `jupyter-bridge.py` per session. The sidecar drives `ipykernel` in-process and speaks JSON-lines (`{type: 'ready'}`, execute, stream/display/error) on stdio; server relays over WebSocket. Idle timeout 30 min.
* **Lifecycle** — `GET /api/notebooks/:sessionId/kernel` (running flag), `POST .../kernel/stop` (force restart).
* **Build:** `jupyter-bridge.py` is copied into `dist/services/` by `npm run build:server` so prod runs without source.

---

## Terminal Sessions

Freeform sessions get a PTY-backed shell tab in the right pane (not a session type — always available on freeform).

* **PTY** — `terminal.ts` uses `node-pty` to spawn `$SHELL` with `cwd=session dir`, `xterm-256color`.
* **WS** — `/ws/terminal/:sessionId/:tabId` (multiple tabs per session via distinct `:tabId`). 256 KB scrollback replayed on reconnect. 30-min idle timeout.

---

## Freeform Sessions (Python/Julia/C++)

Open-ended numerical/scientific experimentation (SPDE simulations, ML experiments, algorithm exploration, C++ practice). Single-file execution model: spawn a child process (`python3`, `julia`, or `g++ && ./a.out`), capture stdout/stderr, log the run. C++ additionally supports the CMake pipeline above.

---

## Core Concepts

### Sessions

The fundamental data unit. A session is a timestamped workspace for a specific activity.

```
interface Session {
  id: string;                          // UUID
  title: string;
  session_type: 'freeform' | 'lean' | 'notebook';
  language: string;                    // 'python' | 'julia' | 'cpp' | 'lean'
  tags: string[];                      // JSON array stored as TEXT
  status: 'active' | 'paused' | 'completed' | 'archived';
  links: SessionLink[];                // Cross-app references
  notes: string;                       // Markdown+LaTeX session notes
  working_dir: string;                 // Relative path under data/sessions/ or data/lean-projects/
  created_at: string;                  // ISO 8601
  updated_at: string;
}
```

### Session Files

```
interface SessionFile {
  id: string;
  session_id: string;
  filename: string;                    // e.g., "Main.lean", "main.py", "notebook.ipynb", "src/order_book.cpp"
  file_type: 'source' | 'output' | 'plot' | 'data' | 'other';
  language: string;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}
```

File content is stored on the filesystem, not in SQLite. The `session_files` table stores metadata only. The session working directory supports nested folders (`files.ts` exposes folder create/rename/delete and a tree endpoint).

### Execution Runs

```
interface ExecutionRun {
  id: string;
  session_id: string;
  file_id: string;
  command: string;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  duration_ms: number;
  created_at: string;
  // CMake-only (nullable for single-file runs):
  build_id: string | null;             // FK → builds.id
  binary_path: string | null;
  flavor: string | null;               // e.g., "Debug-asan"
}
```

### Builds (C++ CMake)

```
interface Build {
  id: string;
  session_id: string;
  flavor: string;                      // e.g., "Debug", "Release-tsan"
  success: boolean;
  duration_ms: number;
  diagnostic_count: number;
  log: string;                         // ANSI-stripped cmake/compiler output
  created_at: string;
}

interface BuildDiagnostic {
  id: string;
  build_id: string;                    // FK → builds.id
  file: string;                        // Relative to project root
  line: number;
  col: number;
  severity: 'error' | 'warning' | 'note';
  message: string;
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

---

## Database Schema (`server/data/pyramid.db`)

SQLite, WAL mode, foreign keys enabled. Created at runtime by `server/src/db.ts`. Tables mirror the TypeScript interfaces above (snake_case columns, `TEXT` ISO-8601 timestamps, `TEXT` UUID primary keys, JSON columns stored as TEXT). Tables: `sessions` (CHECK `session_type IN ('freeform','lean','notebook')`, CHECK `status IN ('active','paused','completed','archived')`), `session_files` (CHECK `file_type IN ('source','output','plot','data','other')`, FK→sessions CASCADE), `execution_runs` (FK→sessions CASCADE, FK→session_files CASCADE; nullable `build_id`/`binary_path`/`flavor` for CMake runs), `lean_session_meta` (UNIQUE `session_id`, CHECK `lake_status IN ('initializing','ready','building','error')`), `builds` (FK→sessions CASCADE), `build_diagnostics` (FK→builds CASCADE), `settings` (key/value).

**Migrations.** `db.ts` applies inline migrations: introspect-and-add columns via `PRAGMA table_info` (added `build_id`/`binary_path`/`flavor` to `execution_runs`); probe-and-rebuild for CHECK constraint changes (used to add `'notebook'` to `session_type` — attempt a rolled-back insert to detect old CHECK, then rename/recreate/copy). Use the probe-and-rebuild pattern for any future CHECK constraint changes.

**Indices:** `sessions(session_type|status|created_at)`, `session_files(session_id)`, `lean_session_meta(session_id)` UNIQUE, `execution_runs(session_id|created_at)`, `builds(session_id|created_at)`, `build_diagnostics(build_id)`.

**JSON columns:** `tags`, `links` stored as JSON TEXT. Parse/serialize in route handlers.

**FTS5:** `sessions_fts(title, notes, tags, content='sessions', content_rowid='rowid')` synced via `sessions_ai` / `sessions_ad` / `sessions_au` triggers (same pattern as Granary's `entries_fts`).

---

## API Endpoints

All under `/api` prefix. RESTful verbs. Parameterized SQL only.

### Sessions

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sessions` | List sessions. Query params: `session_type`, `status`, `language`, `tag`, `search` (FTS5). |
| GET | `/api/sessions/:id` | Get single session with files, type-specific data, recent runs, absolute working dir. |
| POST | `/api/sessions` | Create session. `lean` → scaffolds Lake project (background); `notebook` → seeds an empty `.ipynb`; `cpp` freeform → drops default `.clangd`. |
| PUT | `/api/sessions/:id` | Update title, tags, notes, status, links, language. |
| DELETE | `/api/sessions/:id` | Delete session, dependent rows, working directory; stops any LSP / kernel / terminal / Lean project. |
| PATCH | `/api/sessions/:id/status` | Update status. |

### Session Files & Folders

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sessions/:id/files` | List file metadata. |
| GET | `/api/sessions/:id/tree` | Recursive tree of files + folders under the session working dir. |
| GET | `/api/sessions/:id/files/:fileId` | Get file metadata. |
| GET | `/api/sessions/:id/files/:fileId/content` | Read file content from disk. |
| POST | `/api/sessions/:id/files` | Create a file. Body: `{ filename, language, content?, is_primary? }`. `filename` may include subdirectories. |
| PATCH | `/api/sessions/:id/files/:fileId` | Rename/move file (updates row + filesystem). |
| PUT | `/api/sessions/:id/files/:fileId/content` | Update file content. Body: `{ content: string }`. |
| DELETE | `/api/sessions/:id/files/:fileId` | Delete file from DB and disk. |
| POST | `/api/sessions/:id/folders` | Create a folder. |
| PATCH | `/api/sessions/:id/folders` | Rename a folder. |
| DELETE | `/api/sessions/:id/folders` | Delete a folder. |
| POST | `/api/sessions/:id/upload` | `multipart/form-data` upload (uses `multer`). |

### Execution & Runs

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sessions/:id/runs` | List execution runs (default limit 50). |
| GET | `/api/sessions/:id/runs/:runId` | Single run with full output. |
| POST | `/api/sessions/:id/execute` | Execute. For C++ with `CMakeLists.txt`, takes the CMake path (body: `{ flavor, target?, args?, stdin?, reconfigure?, timeout_ms? }`); otherwise single-file path (body: `{ file_id?, timeout_ms?, stdin? }`). Response shape varies: single-file returns the run row; CMake returns `{ kind: 'ran' \| 'build_failed' \| 'no_binary', build_id, flavor, diagnostics, log, run? }`. |

### CMake (C++ projects)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sessions/:id/cmake/status` | `{ is_cmake_project, project_path }`. |
| POST | `/api/sessions/:id/cmake/configure` | Body: `{ flavor, reconfigure? }`. Runs cmake configure. |
| POST | `/api/sessions/:id/cmake/build` | Body: `{ flavor, target?, jobs?, reconfigure? }`. Configures (if needed) and builds. Persists a `builds` row + diagnostics. |
| GET | `/api/sessions/:id/cmake/builds` | Build history (default limit 50). |
| GET | `/api/sessions/:id/cmake/builds/:buildId` | Single build with diagnostics. |
| GET | `/api/sessions/:id/cmake/binaries` | List executables for a flavor. Query params: `buildType`, `sanitizers` (comma-separated). |
| GET | `/api/sessions/:id/cmake/artifacts` | Tree of `build/` (classified by file kind). |
| GET | `/api/sessions/:id/cmake/artifacts/content?path=<rel>` | Read text artifact (up to 512 KB; pretty-prints `compile_commands.json`). |
| GET | `/api/sessions/:id/cmake/artifacts/download?path=<rel>` | Stream binary artifact as attachment. |
| POST | `/api/sessions/:id/cmake/clean` | Body: `{ all: true }` removes everything; otherwise `{ flavor }` removes one flavor. |

### Lean

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/lean/:sessionId/meta` | Lean session metadata (versions, lake status, last build). |
| POST | `/api/lean/:sessionId/build` | Trigger `lake build`. |
| GET | `/api/lean/:sessionId/build-output` | Last build stdout/stderr. |
| WS | `/ws/lean/:sessionId` | LSP relay (browser ↔ `lean --server`). |

### Notebooks

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/notebooks/:sessionId/kernel` | `{ running: boolean }`. |
| POST | `/api/notebooks/:sessionId/kernel/stop` | Stop the kernel (next WS connect will start a fresh one). |
| WS | `/ws/notebook/:sessionId` | Kernel relay (browser ↔ `jupyter-bridge.py`). |

### C++ LSP & Terminal (WebSocket only)

| Method | Path | Description |
|--------|------|-------------|
| WS | `/ws/cpp/:sessionId` | clangd LSP relay. Server gates on `session.language === 'cpp'`. Drops a `.clangd` config if missing. |
| WS | `/ws/terminal/:sessionId/:tabId` | PTY relay for freeform sessions. Multiple tabs per session via distinct `:tabId`. |

### Compiler Explorer

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/godbolt/compilers?lang=c++` | List compilers (cached 6h). |
| POST | `/api/godbolt/compile` | Compile a snippet. Body: `{ compilerId, source, userArguments?, filters? }`. 256 KB source cap. |

### Claude AI

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/sessions/:id/claude/ask` | Send prompt with context. Body: `{ prompt, context: [{label, content}], mode }`. |

### Scribe Proxy

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/scribe/flowcharts` | Proxied to Scribe (port 3003). |
| GET | `/api/scribe/nodes/search?title=<query>` | Search Scribe nodes. |
| GET | `/api/scribe/nodes/:flowchartId/:nodeKey` | Fetch a single Scribe node. |

### Stats / Settings / Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/stats/overview` | Sessions by type, active count, total runs. |
| GET | `/api/stats/heatmap` | Activity by date. Query params: `start`, `end`. |
| GET | `/api/stats/languages` | Runs by language. |
| GET | `/api/settings` / `GET /api/settings/:key` / `PUT /api/settings/:key` | Key-value settings (incl. `claude_api_key`). |
| GET | `/api/health` | `{ status: 'ok', timestamp }`. |

### Error Responses

HTTP status codes: 201 (created), 400 (bad input), 404 (not found), 409 (conflict), 413 (payload too large — godbolt source cap), 500 (server error), 502 (upstream failure — Scribe / godbolt). Error body: `{ error: 'descriptive message' }`. Every route handler wrapped in try-catch.

---

## Execution Service (single-file)

`server/src/services/execution.ts` spawns child processes for single-file freeform runs:

* **Isolation:** each session has its own working directory; processes run with `cwd` set there.
* **Timeout:** default 30 seconds (single-file) / 120 seconds (CMake). SIGTERM with 2-second SIGKILL grace.
* **Capture:** stdout and stderr piped, truncated to 1 MB each.
* **Language commands:**
  - Python: `python3 <file>`
  - Julia: `julia <file>`
  - C++: `g++ -O2 -std=c++20 -Wall -Wextra -o a.out <file> && ./a.out`
  - Lean (one-off): `lake env lean <file>`
* **No sandboxing:** personal tool running locally.

---

## Client Views & Routing

| Path | Component | Description |
|------|-----------|-------------|
| `/` | `DashboardPage` | Overview: active sessions, recent activity, heatmap |
| `/sessions` | `SessionListPage` | Browse / filter / search all sessions |
| `/sessions/new` | `NewSessionPage` | Create session (pick type — freeform / notebook / lean — and language) |
| `/sessions/:id` | `SessionPage` | The main workbench (layout varies by session type) |

### SessionPage — Lean Mode

Resizable split-pane:

* **Left:** CodeMirror 6 editor with Lean 4 syntax highlighting, Unicode input (`\forall` → `∀`, etc.), inline diagnostics. Symbol palette dropdown for tactile insertion.
* **Right tabs:**
  - **Goal State** (default) — `$/lean/plainGoal` rendered with KaTeX. Updates on cursor move. "No goals" / "Proof complete ✓".
  - **Messages** — Lean info messages (`#check`, `#eval`, `#print`).
  - **Claude** — AI assistant.
  - **Notes** — Markdown+LaTeX. Auto-saved with 1500ms debounce.
  - **Links** — Cross-app references.
* **Toolbar:** Build button (`lake build`), lake status indicator, session status. "Ask Claude" appears when error diagnostics are present.

### SessionPage — Freeform Mode (Python / Julia / C++)

Resizable split-pane with a vertical split inside the right pane (tabs on top, terminal on bottom).

* **Left:** CodeMirror 6 editor with file-tab strip and (optional) `FileTree` for multi-file projects. C++ files get full clangd integration (diagnostics, hover, completion). Python files get `@codemirror/lang-python`.
* **Right tabs (C++ shows the full set; other languages omit build/artifacts/outline/asm):**
  - **Output** — stdout/stderr from the latest run; scrollable run history.
  - **Build** (C++ CMake) — `BuildPanel`: flavor picker, target input, build button, parsed diagnostics list (clickable to file:line:col), build history.
  - **Artifacts** (C++ CMake) — `ArtifactBrowser`: tree of `build/` with download / view-as-text.
  - **Outline** (C++) — `OutlinePanel`: clangd document symbols as a tree.
  - **Asm** (C++) — `CompilerExplorerPanel`: pick a godbolt compiler, view assembly for the current source.
  - **Claude** — AI assistant.
  - **Notes** — Markdown+LaTeX session notes.
  - **Links** — Cross-app references.
* **Bottom of right pane:** `TerminalPane` (xterm.js) attached to the session's PTY, with multiple tab support.
* **Toolbar:** Run button (CMake-aware in C++), language indicator, session status. "Ask Claude" appears when a run fails.

### SessionPage — Notebook Mode

* **Left:** `NotebookEditor` — cell list with code/markdown cells, per-cell run, output rendering (text/HTML/images), `FileTree` for ancillary files in the session directory. Auto-completion via `useNotebookKernel` calling into the kernel.
* **Right tabs:** Claude / Notes / Links (same as other types). No goal state, no build, no terminal.

---

## Key Dependencies

**Frontend:**

* React 18, React Router 6, Vite 6, TypeScript 5
* CodeMirror 6 — `codemirror`, `@codemirror/lang-cpp`, `@codemirror/lang-python`, `@codemirror/theme-one-dark`. Lean uses a hand-rolled CodeMirror language pack with Unicode input.
* xterm.js — `@xterm/xterm`, `@xterm/addon-fit` (terminal panel).
* KaTeX 0.16 (LaTeX rendering in goal state and notes).
* Recharts (dashboard charts), date-fns, uuid.

**Backend:**

* Express 4, TypeScript 5, better-sqlite3 11+, ws (WebSocket), cors, tsx (dev).
* `node-pty` — PTY-backed terminals. Native module; rebuilds on install.
* `multer` — file uploads.
* `child_process` (Node built-in) — language servers, kernels, build tools.

**External tools (must be in PATH):**

* `lean` + `lake` — via [elan](https://github.com/leanprover/elan). Required for Lean sessions.
* `clangd` — for C++ LSP.
* `cmake` — for CMake C++ projects. `ninja` is auto-detected and preferred when present.
* `g++` (with C++20 support) — for C++ single-file execution and as the clangd `--query-driver` reference.
* `python3` with `ipykernel` — for notebook sessions and the jupyter bridge.
* `julia` — optional, for Julia freeform sessions.
* `git` — for Lake/Mathlib dependency management.

**Do NOT add:** any ORM, any state management library beyond React hooks + prop drilling, an LSP client library on the frontend (the bridge is just JSON over WebSocket — implement the minimal client directly).

---

## Conventions

### Code Style

* **TypeScript strict mode** in both client and server tsconfig.
* **Naming:** camelCase for variables/functions, PascalCase for components/interfaces/types, snake_case for database columns and table names, UPPER_CASE for constants.
* **Imports:** named imports from libraries, relative paths for local files.
* **No linter or formatter config** — follow existing code style in each file.

### Component Structure

* Each component in its own folder: `components/ComponentName/ComponentName.tsx` + `ComponentName.module.css`.
* Pages: `pages/PageName/PageName.tsx` + `PageName.module.css`.
* **CSS Modules** exclusively — no Tailwind.
* Design tokens as CSS custom properties in `global.css` under `:root` and `[data-theme="dark"]`.

### Theming

Two themes: light (default) and dark. Toggle by setting `data-theme="dark"` on `document.documentElement`; persist to localStorage (`pyramid_theme`); consume through `ThemeContext`. Eight color schemes selectable via the theme menu. CSS custom properties everywhere.

### Service Layer

* Services are **plain objects** (not classes) exported as `const serviceName = { ... }`.
* Server-backed services are async, use `fetch()` for REST and `WebSocket` for LSP / kernel / terminal.
* Client-only services (theme, editor prefs) use localStorage.
* Services do NOT use React hooks; hooks wrap services.

### Server Conventions

* Routes in `server/src/routes/` — one file per resource.
* Database schema and init in `server/src/db.ts`. Inline migrations are introspect-and-alter; for CHECK constraints, probe-then-rebuild (see the `notebook` migration for the canonical pattern).
* JSON columns stored as TEXT, parsed/serialized in route handlers.
* CORS enabled (`*` origin) for LAN access from iPad and other devices.
* Parameterized SQL only.
* Route-level try-catch wrapping.
* WebSocket upgrade routing lives in `server/src/index.ts` — match the path with a regex, validate the session type/language, then hand the socket to the appropriate service. Sockets are destroyed on validation failure.

### LSP Conventions

* **All shared LSP behavior lives in `lsp-bridge.ts`.** Wrappers (`lean-lsp.ts`, `cpp-lsp.ts`) only specify command/args/cwd/env and a `logPrefix`.
* Don't interpret LSP messages in the bridge beyond `initialize` / `initialized` (caching + dedup). Routing logic and any LSP-specific message inspection belong on the client.
* When adding a new LSP, add the wrapper and a new `/ws/<name>/:sessionId` upgrade handler — nothing else.

### LaTeX Rendering

**KaTeX** for all math rendering (session notes, goal state panel).

### Date Handling

**CST (UTC-6, fixed offset)** — same convention as Scribe and Granary.

### ID Generation

`crypto.randomUUID()` (and `uuid.v4()` on the server) for all IDs.

---

## Claude API Integration

Pyramid integrates with the Anthropic Claude API for AI-assisted coding and proof development.

### API Key Management

Stored in the `settings` table (`claude_api_key`). Configured via the Settings modal (gear icon in sidebar). Read server-side only — never sent to the client.

### Ask Endpoint

```
POST /api/sessions/:id/claude/ask
Body: { prompt: string, context: Array<{label, content}>, mode: ClaudeMode }
Response: { response: string, input_tokens: number, output_tokens: number }
```

The server reads the API key, builds a system prompt for the mode, assembles context blocks into the user message, and calls the Anthropic Messages API.

### System Prompt Modes (`server/src/services/claude-prompts.ts`)

| Mode | Description |
|------|-------------|
| `error_diagnosis` | Analyzes errors (Lean diagnostics, build diagnostics, runtime errors). Separate prompts for Lean vs C++ vs other. |
| `formalization_help` | Translates informal math into Lean 4 proofs. Lean sessions only. |
| `implementation_help` | Helps implement algorithms / methods. Freeform & notebook. |
| `general` | Open-ended coding assistant. |

### Context Auto-Assembly (Client)

`ClaudePanel` automatically assembles context:

1. **Current file** — always included
2. **Diagnostics** — Lean LSP errors / clangd diagnostics / latest CMake build diagnostics
3. **Goal state** (Lean) — current tactic goal
4. **Last run output** (freeform / notebook) — stdout/stderr from a failed run
5. **Scribe nodes** — fetched from linked Scribe flowchart nodes (or added via search picker)

### Scribe Proxy

`server/src/routes/scribe-proxy.ts` proxies to Scribe at `http://localhost:3003` with a 3-second timeout. Graceful degradation: if Scribe is not running, endpoints return empty results.

---

## Testing

No test framework configured. Validate changes by running `npm run build` (which runs `tsc` for both client and server).

---

## How-Tos

### Adding a New Session Type

1. Add to `session_type` CHECK in `server/src/db.ts` and add a probe-and-rebuild migration block (see the `notebook` example).
2. Add to `SessionType` union in `client/src/types.ts`.
3. Add a creation form variant in `NewSessionPage`.
4. Add type-specific tables in `server/src/db.ts` if needed.
5. Add type-specific tabs/panels in `SessionPage`.
6. Add type-specific routes in `server/src/routes/`.

### Adding a New Language Server

1. Write a thin wrapper in `server/src/services/<lang>-lsp.ts` that calls into `LspBridge` (mirror `cpp-lsp.ts`).
2. Add a `/ws/<lang>/:sessionId` upgrade handler in `server/src/index.ts`. Validate the session, then call the wrapper.
3. Wire `forceStopAll()` of the new wrapper into the shutdown handler.
4. On the client, write a `useXxxLsp` hook (mirror `useCppLsp.ts`) — JSON-RPC over WebSocket, no LSP client library.

### Adding a New Language (single-file freeform)

1. Add to the command map in `server/src/services/execution.ts`.
2. Add a CodeMirror language mode in `CodeEditor`.
3. Add to the language selector in `NewSessionPage`.
4. Verify runtime availability (add a startup check if it's a hard dependency).

### Adding a New API Endpoint

1. Create or edit a route file in `server/src/routes/`.
2. Register in `server/src/index.ts`.
3. Add tables in `server/src/db.ts` if needed (with a migration if changing existing tables).

### Adding a New Page

1. Create `client/src/pages/NewPage/NewPage.tsx` + `NewPage.module.css`.
2. Add `<Route>` in `client/src/App.tsx`.
3. Add nav link in `Layout`.
