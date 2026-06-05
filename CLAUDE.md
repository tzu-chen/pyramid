# Pyramid — CLAUDE.md

Guidance for Claude Code working in this repo.

## Project Overview

Pyramid is a **computational workbench** for **Lean 4 proof development**, **freeform numerical/scientific computation** (Python/Julia/C++ with full clangd/CMake support for C++), and **Jupyter-style notebooks**, usable from any device including iPad. Built-in **Claude AI** for error diagnosis, formalization, and implementation help. **Sessions** are the core abstraction — each bundles code, outputs, notes, and provenance links into a logged, searchable unit.

The Lean and C++ experiences are the two most distinctive features. Both ride the same generic **LSP bridge** (`lsp-bridge.ts`): the backend spawns a language server (`lean --server` or `clangd`) per session and proxies LSP JSON-RPC over WebSocket. C++ sessions additionally get a CMake build/run pipeline, artifact browser, document outline, and Compiler Explorer integration.

Part of a personal research ecosystem; siblings share the same stack/conventions (reference Granary or Navigate when in doubt): **Navigate** (arXiv + AI chat), **Scribe** (PDFs/notes/flowcharts), **Monolith** (LaTeX editor, Tectonic backend), **Granary** (research log/spaced repetition).

## Build & Development

```
npm run install:all   # deps for root, server/, client/
npm run dev           # frontend (Vite) + backend (Express) concurrently
npm run dev:server    # backend only (Express :3007, tsx watch)
npm run dev:client    # frontend only (Vite :5177)
npm run build         # build client + server (tsc both)  ← also the only "test"
npm start             # prod: serves API + built frontend
```

`build:server` copies `jupyter-bridge.py` into `dist/services/`. No test framework — validate with `npm run build`.

**Ports:** server **3007**, Vite dev **5177** (proxies `/api` and `/ws` to 3007). Chosen to avoid Navigate (3001), Scribe (3003), Monolith (3005), Granary (3009).

**Env (no `.env` files):** `PORT` (default 3007), `SUITE_DATA_ROOT` (optional).

**Data location — `server/src/paths.ts` is the single source.** Exports `DATA_DIR`, `SESSIONS_DIR`, `LEAN_PROJECTS_DIR`, `resolveSessionCwd`; imported by `db.ts`, `index.ts`, and the sessions/files/execution/lean routes + `lean-project.ts`. With `SUITE_DATA_ROOT` set, data lives at `$SUITE_DATA_ROOT/pyramid/`; unset, it falls back **byte-for-byte** to in-repo `server/data/`. A session's `working_dir` is stored **relative to `DATA_DIR`** (e.g. `sessions/<id>`) and resolved via `resolveSessionCwd`. Legacy `data/<…>` rows were rebased once (`UPDATE sessions SET working_dir = substr(working_dir, 6) WHERE working_dir LIKE 'data/%'`). **Never** reintroduce the `data/` prefix or join `__dirname` with `working_dir`.

## Architecture

Full-stack TypeScript: React 18 + Vite frontend, Express + better-sqlite3 backend, with WebSocket support for LSP, Jupyter kernels, and PTY terminals.

```
client/src/
  main.tsx, App.tsx, types.ts, styles/global.css
  components/  ArtifactBrowser, BuildPanel, ClaudePanel, CodeEditor (CodeMirror 6 + LSP),
               CompilerExplorerPanel, CsvViewer, FileTree, GoalStatePanel, NotebookEditor,
               OutlinePanel, SettingsModal, SymbolPalette, TerminalPane
  pages/       Dashboard, SessionList, NewSession, SessionPage
  services/    REST + WebSocket clients (plain objects, no hooks)
  hooks/       useLeanLsp, useCppLsp, useNotebookKernel, useTerminal, useSession, ...
  contexts/    Theme, editor font size
server/src/
  index.ts     Express entry, route mounts, WebSocket upgrade routing
  db.ts        SQLite schema + migrations
  paths.ts     data-dir resolution (see above)
  session-types.ts  SessionType union + isFreeformType()
  routes/      one file per resource
  services/
    lsp-bridge.ts      generic LSP-over-WS relay (lifecycle, framing, idle timeout, init caching)
    lean-lsp.ts        thin wrapper: spawns `lean --server`
    lean-project.ts    Lake project scaffolding + build
    cpp-lsp.ts         thin wrapper: spawns `clangd`
    cpp-project.ts     drops default `.clangd`
    cpp-build.ts       CMake configure/build/run, diagnostic parser, artifact tree
    execution.ts       single-file Python/Julia/C++ child-process runner
    notebook-kernel.ts Jupyter kernel lifecycle + WS relay
    jupyter-bridge.py  Python sidecar driving ipykernel; JSON-lines on stdio
    terminal.ts        node-pty shell sessions
    godbolt.ts         Compiler Explorer REST client + cache
    claude.ts          Anthropic Messages API client
    claude-prompts.ts  system prompts per mode
    scribe.ts          Scribe cross-app proxy client
```

### LSP Bridge (`lsp-bridge.ts`)

One generic `LspBridge` class runs every LSP server. It owns:
* **Process lifecycle** — `start(sessionId, config)` spawns the binary with configured `cwd`/`args`/`env`; idempotent.
* **LSP framing** — `Content-Length` framed JSON-RPC over the server's stdio.
* **WebSocket fan-out** — `handleWebSocket(ws, sessionId, config)` attaches a browser client; multiple clients per session (broadcast). Idle timeout (default 30 min) starts when the last client disconnects; force-stop on shutdown.
* **Initialize caching** — first `initialize` is forwarded and cached; reconnecting clients get the cached result (a duplicate initialize crashes most servers). `initialized` forwarded exactly once.

`lean-lsp.ts` / `cpp-lsp.ts` are ~30-line wrappers exporting a `handleWebSocket` that supplies command/args/cwd/env/logPrefix. **All shared LSP behavior lives in `lsp-bridge.ts`** — for a new server, write another thin wrapper, don't reimplement the bridge. Don't interpret messages in the bridge beyond initialize/initialized; LSP-specific logic belongs on the client.

## Lean 4 Integration

* **Lake project per session** under `data/lean-projects/<session_id>/` (`lakefile.toml` with Mathlib dep, `lean-toolchain` pinned to a Mathlib-compatible version, starter `Main.lean`). Scaffolded **in the background** by `lean-project.ts` after the session row inserts; progress in `lean_session_meta.lake_status` (`initializing` → `ready`/`error`). Creation runs `lake exe cache get` for prebuilt Mathlib `.olean`.
* **Mathlib cache** is ~5GB — share it via `MATHLIB_CACHE_DIR` or by symlinking `~/.elan` and `~/.cache/mathlib`; don't re-download per session.
* **`lean --server` per session** via `LspBridge`; long-lived, survives reconnects. Relay at `/ws/lean/:sessionId`; server validates `lean_session_meta` exists or destroys the socket.
* **Goal state** from `$/lean/plainGoal` (note: Lean 4 uses `$/lean/plainGoal`, **not** `Lean/plainGoal`), rendered with KaTeX.
* **`lake build`** is only needed for final verification / the Build button; the LSP handles incremental re-elaboration.
* Client uses: didOpen/didChange, publishDiagnostics, `$/lean/plainGoal`, completion, hover.

## C++ Integration

Two modes coexist per freeform C++ session, decided per-execute by `isCmakeProject()` (= `existsSync(<dir>/CMakeLists.txt)`), so a session is promoted single-file → CMake just by adding `CMakeLists.txt`:
* **Single-file** (`execution.ts`): `g++ -O2 -std=c++20 -Wall -Wextra -o a.out <file> && ./a.out`.
* **CMake** (`cpp-build.ts`): configure → build → run with flavors, sanitizers, parsed diagnostics, artifacts.

**clangd** (every freeform C++ session): `cpp-lsp.ts` spawns `clangd --background-index --clang-tidy --header-insertion=never --completion-style=detailed --pch-storage=memory --log=error`. `cpp-project.ts` drops a default `.clangd` on creation **and every WS connect** (idempotent → old sessions get one on reopen): `-std=c++20 -Wall -Wextra -Wpedantic -Wshadow`, `g++` for system headers, `modernize-*/performance-*/bugprone-*/readability-*` tidy checks. On configure, `cpp-build.ts` symlinks (copy fallback) `build/<flavor>/compile_commands.json` to project root so clangd gets real flags. Client requests `textDocument/documentSymbol` → `OutlinePanel`.

**CMake pipeline (`cpp-build.ts`):**
* **Flavors** — `BuildType` ∈ {Debug, Release, RelWithDebInfo, MinSizeRel} × optional `Sanitizer[]` ∈ {asan, tsan, ubsan, msan}, validated (tsan ⊥ asan/msan; asan ⊥ msan; no dups). Maps to dir name like `Debug-asan-ubsan` under `build/`; flavors coexist.
* **Generator** — Ninja if on PATH, else cmake default.
* **Configure** — `cmake -S … -B … -DCMAKE_BUILD_TYPE=… -DCMAKE_EXPORT_COMPILE_COMMANDS=ON [-DCMAKE_CXX_FLAGS=…]`. Cached unless `reconfigure: true` (skips when `CMakeCache.txt` + `compile_commands.json` exist).
* **Build** — `cmake --build … -j<cpus> [--target …]`; ANSI stripped (`CLICOLOR_FORCE=0`, `CMAKE_COLOR_DIAGNOSTICS=OFF`) for clean parsing.
* **Diagnostic parser** — regex `file:line:col: severity: message` → `CompilerDiagnostic[]` with normalized relative paths; `fatal error`→`error`; continuation lines fold into the last diagnostic until blank.
* **Run** — picks binary (by `target`, else first executable under `build/<flavor>/`), optional `args`/`stdin`/`timeoutMs` (default 30s); SIGTERM + 2s SIGKILL grace.
* **Persistence** — each `ensureBuilt` writes a `builds` row + one `build_diagnostics` per diagnostic; successful runs set `execution_runs.build_id`/`binary_path`/`flavor`.
* **Cleanup** — `cleanFlavor` (one `build/<flavor>/`) / `cleanAll` (whole `build/` + compile_commands symlink).

**Artifact browser** — tree of `build/`, files classified `executable`/`object`/`archive`/`shared_lib`/`compile_commands`/`cmake`/`text`/`binary`/`dir`. ≤4000 entries walked, symlinks skipped. `readArtifactText` ≤512 KB (pretty-prints canonical `compile_commands.json`); download streams binaries as attachment. `resolveArtifactPath` rejects `..`, absolute paths, NUL, >32 segments.

**Compiler Explorer (`godbolt.ts`)** — thin REST client for godbolt.org, the **only** external network call (degrades gracefully offline). `GET /api/godbolt/compilers?lang=c++` (cached 6h); `POST /api/godbolt/compile` (256 KB source cap, 20s timeout).

## Other Session Types

* **Notebook** — single `.ipynb` in the working dir (edited as JSON, written via the file-content endpoint; no schema beyond `session_files`). `notebook-kernel.ts` spawns one `jupyter-bridge.py` per session driving `ipykernel`, JSON-lines on stdio, relayed over `/ws/notebook/:sessionId`; idle 30 min. `GET .../kernel` (running), `POST .../kernel/stop` (force restart).
* **Terminal** (any freeform session, not a type) — `terminal.ts` uses `node-pty` to spawn `$SHELL` (`cwd`=session dir, `xterm-256color`); `/ws/terminal/:sessionId/:tabId`, multiple tabs, 256 KB scrollback replay, idle 30 min.
* **Freeform (Python/Julia/C++)** — open-ended single-file execution: spawn child (`python3`/`julia`/`g++ && ./a.out`), capture, log. C++ also gets the CMake pipeline.

## Core Concepts

**Sessions** — the fundamental unit. `session_type` ∈ `python | cpp | ocaml | julia | lean | notebook`; `language` mirrors the type for language sessions (`python` for notebook, `lean` for lean). Other fields: `title`, `tags` (JSON TEXT), `status` ∈ `active|paused|completed|archived`, `links` (cross-app, JSON TEXT), `notes` (Markdown+LaTeX), `working_dir` (relative — see Data location), `created_at`/`updated_at` (ISO 8601).

Each freeform language is its own first-class `session_type`; `lean`/`notebook` are the structured types. Shared "freeform-like" behavior (terminal, clangd/ocamllsp, CMake/dune, artifacts, right-pane layout) applies to **any type that isn't `lean` or `notebook`** — encoded once as `isFreeformType()` in `server/src/session-types.ts` and `client/src/types.ts`, **not** scattered `=== 'freeform'` checks. Adding a freeform language is mostly a `session_type` CHECK migration + a New Session card.

**Session files** — metadata only in `session_files` (`file_type` ∈ `source|output|plot|data|other`); content lives on the filesystem. Working dir supports nested folders (`files.ts` has folder create/rename/delete + tree).

**Execution runs** — `execution_runs`: command, exit_code, stdout, stderr, duration_ms, + nullable `build_id`/`binary_path`/`flavor` for CMake runs.

**Builds / diagnostics** (C++ CMake) — `builds` (flavor, success, duration_ms, diagnostic_count, ANSI-stripped log) + `build_diagnostics` (file, line, col, severity, message).

**Cross-app links** — `{ app: navigate|scribe|monolith|granary, ref_type: arxiv_id|paper_id|note_id|flowchart_node|project|entry_id, ref_id, label? }`.

## Database (`server/data/pyramid.db`)

SQLite, WAL, FKs on; created/migrated at runtime by `db.ts`. snake_case columns, TEXT ISO-8601 timestamps, TEXT UUID PKs, JSON-as-TEXT (`tags`, `links` — parse/serialize in handlers). Tables: `sessions` (CHECK on `session_type`, `status`), `session_files` (CHECK `file_type`, FK→sessions CASCADE), `execution_runs` (FK→sessions/session_files CASCADE), `lean_session_meta` (UNIQUE `session_id`, CHECK `lake_status`), `builds` (FK→sessions), `build_diagnostics` (FK→builds), `settings` (k/v).

**Migrations** — introspect-and-add columns via `PRAGMA table_info`; **probe-and-rebuild** for CHECK changes: attempt a rolled-back insert to detect the old CHECK, then rename/recreate/copy (translating rows) and re-create FTS triggers. Used to add `notebook` and to split legacy `freeform` into per-language types. **Use probe-and-rebuild for any future CHECK change.**

**Indices:** `sessions(session_type|status|created_at)`, `session_files(session_id)`, `lean_session_meta(session_id)` UNIQUE, `execution_runs(session_id|created_at)`, `builds(session_id|created_at)`, `build_diagnostics(build_id)`. **FTS5:** `sessions_fts(title, notes, tags)` (content=`sessions`) synced via `sessions_ai/ad/au` triggers (Granary's `entries_fts` pattern).

## API

All under `/api`, RESTful, parameterized SQL only, route-level try-catch. Errors: `{ error: msg }` with 201/400/404/409/413(godbolt cap)/500/502(Scribe/godbolt upstream). Browse `server/src/routes/` for exact shapes; notable contracts:

* **Sessions** — `GET /sessions` (filters: `session_type`, `status`, `language`, `tag`, `search`=FTS5); `GET/PUT/DELETE /sessions/:id` (GET returns files + type data + recent runs + absolute cwd; DELETE also stops LSP/kernel/terminal/Lean project); `POST /sessions` derives `language`, and per type: `lean`→scaffold Lake (bg), `notebook`→seed `.ipynb`, `cpp`→`.clangd`, `ocaml`→`.ocamlformat`/`.merlin`; `PATCH /sessions/:id/status`.
* **Files/folders** — under `/sessions/:id`: `files` (list/create — filename may include subdirs), `tree`, `files/:fileId` (GET/PATCH rename-move/DELETE), `files/:fileId/content` (GET/PUT), `folders` (POST/PATCH/DELETE), `upload` (multer multipart).
* **Execute** — `POST /sessions/:id/execute`: C++-with-CMake takes `{ flavor, target?, args?, stdin?, reconfigure?, timeout_ms? }` and returns `{ kind: 'ran'|'build_failed'|'no_binary', build_id, flavor, diagnostics, log, run? }`; single-file takes `{ file_id?, timeout_ms?, stdin? }` and returns the run row. `GET /sessions/:id/runs[/:runId]`.
* **CMake** — `/sessions/:id/cmake/`: `status`, `configure`, `build` (persists builds+diagnostics), `builds[/:buildId]`, `binaries` (`?buildType&sanitizers`), `artifacts`, `artifacts/content?path=`, `artifacts/download?path=`, `clean` (`{all:true}` or `{flavor}`).
* **Lean** — `/lean/:sessionId/`: `meta`, `build`, `build-output`; WS `/ws/lean/:sessionId`.
* **Notebooks** — `/notebooks/:sessionId/kernel` (GET running, POST `kernel/stop`); WS `/ws/notebook/:sessionId`.
* **WS** — `/ws/cpp/:sessionId` (gated on `language==='cpp'`, drops `.clangd`), `/ws/terminal/:sessionId/:tabId`.
* **Godbolt** — `/godbolt/compilers`, `/godbolt/compile`.
* **Claude** — `POST /sessions/:id/claude/ask` `{ prompt, context: [{label, content}], mode }` → `{ response, input_tokens, output_tokens }`.
* **Scribe proxy** — `/scribe/flowcharts`, `/scribe/nodes/search?title=`, `/scribe/nodes/:flowchartId/:nodeKey`.
* **Stats/settings/health** — `/stats/{overview,heatmap,languages}`, `/settings[/:key]` (incl. `claude_api_key`), `/health`.

**Execution service** (`execution.ts`, single-file): own cwd per session; timeout 30s single-file / 120s CMake (SIGTERM + 2s SIGKILL); stdout/stderr truncated to 1 MB. Commands — Python `python3 <f>`, Julia `julia <f>`, C++ `g++ -O2 -std=c++20 -Wall -Wextra -o a.out <f> && ./a.out`, Lean one-off `lake env lean <f>`. No sandboxing (local personal tool).

## Client Views

Routes: `/` Dashboard (active sessions, activity, heatmap), `/sessions` list (filter/search), `/sessions/new`, `/sessions/:id` SessionPage (layout varies by type).

**SessionPage layouts** (resizable split-pane; CodeMirror 6 left):
* **Lean** — left: Lean syntax + Unicode input (`\forall`→∀) + inline diagnostics + symbol palette. Right tabs: Goal State (KaTeX, updates on cursor; default), Messages (`#check`/`#eval`/`#print`), Claude, Notes (Markdown+LaTeX, 1500ms debounce), Links. Toolbar: Build, lake status, status; "Ask Claude" on error diagnostics.
* **Freeform (Python/Julia/C++)** — right pane vertically split (tabs over terminal). Left: file-tab strip + optional `FileTree`; C++ gets full clangd, Python gets `@codemirror/lang-python`. Right tabs (C++ full set; others omit build/artifacts/outline/asm): Output, Build (`BuildPanel`), Artifacts (`ArtifactBrowser`), Outline (`OutlinePanel`), Asm (`CompilerExplorerPanel`), Claude, Notes, Links. Bottom: `TerminalPane` (xterm.js, multi-tab). Toolbar: Run (CMake-aware), language, status; "Ask Claude" on failed run.
* **Notebook** — left: `NotebookEditor` (code/markdown cells, per-cell run, text/HTML/image output, `FileTree`, completion via `useNotebookKernel`). Right tabs: Claude / Notes / Links only.

## Claude API Integration

Key in `settings.claude_api_key` (Settings modal), **read server-side only, never sent to client**. `claude.ts` reads key, builds a per-mode system prompt, assembles context blocks into the user message, calls the Messages API.

**Modes** (`claude-prompts.ts`): `error_diagnosis` (separate Lean/C++/other prompts), `formalization_help` (Lean only), `implementation_help` (freeform/notebook), `general`.

**Context auto-assembly** (`ClaudePanel`): current file (always) + diagnostics (Lean LSP / clangd / latest CMake build) + goal state (Lean) + last failed run output (freeform/notebook) + linked/searched Scribe nodes.

**Scribe proxy** (`scribe-proxy.ts`) → `http://localhost:3003`, 3s timeout, degrades to empty if Scribe is down.

## Conventions

* **Code style** — TS strict (both tsconfigs); camelCase vars/fns, PascalCase components/types, snake_case DB, UPPER_CASE consts; named library imports, relative local imports. No linter/formatter — match the file.
* **Components** — `components/Name/Name.tsx` + `Name.module.css` (CSS Modules only, no Tailwind); pages likewise. Design tokens as CSS custom props in `global.css` under `:root` / `[data-theme="dark"]`.
* **Theming** — light (default) / dark via `data-theme` on `<html>`, persisted to `localStorage.pyramid_theme`, via `ThemeContext`; 8 color schemes. CSS custom properties everywhere.
* **Services** — plain objects `const x = {…}`, never classes, never React hooks (hooks wrap services). Server-backed use `fetch`/`WebSocket`; client-only (theme, editor prefs) use localStorage.
* **Server** — one route file per resource; schema/migrations in `db.ts`; JSON cols as TEXT; CORS `*` (LAN/iPad); parameterized SQL; route-level try-catch. WS upgrade routing in `index.ts`: regex-match path, validate type/language, hand off — destroy socket on failure.
* **LSP** — shared behavior in `lsp-bridge.ts`; wrappers only set command/args/cwd/env/logPrefix; new LSP = wrapper + `/ws/<name>/:sessionId` handler, nothing else.
* **Misc** — KaTeX for all math; dates in **CST (UTC-6 fixed)** (matches Scribe/Granary); IDs via `crypto.randomUUID()` (server also `uuid.v4()`).

**Do NOT add:** any ORM; any state lib beyond React hooks + prop drilling; a frontend LSP client library (the bridge is just JSON over WebSocket — write the minimal client directly).

## Key Dependencies

**Frontend:** React 18, React Router 6, Vite 6, TS 5; CodeMirror 6 (`codemirror`, `@codemirror/lang-cpp`, `@codemirror/lang-python`, `@codemirror/theme-one-dark`; Lean uses a hand-rolled language pack with Unicode input); xterm.js (`@xterm/xterm`, `@xterm/addon-fit`); KaTeX 0.16; Recharts, date-fns, uuid.

**Backend:** Express 4, TS 5, better-sqlite3 11+, ws, cors, tsx (dev), `node-pty` (native, rebuilds on install), `multer`, `child_process`.

**External tools (PATH):** `lean`+`lake` (via elan; Lean sessions), `clangd` (C++ LSP), `cmake` (+ `ninja` auto-preferred), `g++` (C++20; single-file + clangd query-driver), `python3`+`ipykernel` (notebooks/bridge), `julia` (optional), `git` (Lake/Mathlib).

## How-Tos

**New session type:** `session_type` CHECK + probe-and-rebuild migration in `db.ts` → `SessionType` union in `client/src/types.ts` → form variant in `NewSessionPage` → type-specific tables (if needed), tabs/panels in `SessionPage`, routes.

**New language server:** thin wrapper `server/src/services/<lang>-lsp.ts` (mirror `cpp-lsp.ts`) → `/ws/<lang>/:sessionId` upgrade handler in `index.ts` (validate then call) → wire its `forceStopAll()` into shutdown → client `useXxxLsp` hook (mirror `useCppLsp.ts`, JSON-RPC over WS, no LSP lib).

**New freeform language** (overlaps "new session type"): add to `session_type` CHECK (+ migration) and the `SessionType`/`FREEFORM_SESSION_TYPES` unions in `session-types.ts` + `client/src/types.ts` → command map in `execution.ts` → CodeMirror mode in `CodeEditor` → New Session card + `LANGUAGE_FOR_TYPE` + `SessionListPage` filter + Badge color → runtime-availability check if it's a hard dep. `isFreeformType()` already gates terminal/LSP.

**New API endpoint:** route file in `routes/` → register in `index.ts` → tables/migration in `db.ts` if needed.

**New page:** `pages/NewPage/NewPage.tsx` + `.module.css` → `<Route>` in `App.tsx` → nav link in `Layout`.
