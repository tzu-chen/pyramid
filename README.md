# Pyramid

A computational workbench for **Lean 4 proof development**, **C++ engineering** with full clangd + CMake support, **freeform numerical computation** (Python / Julia), and **Jupyter-style notebooks** — all accessible from any device on the local network, including iPad, via the browser. Includes built-in **Claude AI integration** for error diagnosis, formalization help, and implementation assistance.

## Features

### Lean 4 Proof Development

- **Interactive proof environment** — editor + tactic goal state panel + diagnostics, all in the browser
- **Full LSP integration** — backend spawns a `lean --server` per session and proxies LSP JSON-RPC over WebSocket
- **Mathlib support** — each session gets a proper Lake project with Mathlib as a dependency and shared prebuilt artifact cache
- **Goal state panel** — tactic goals rendered with KaTeX, updated live on cursor movement
- **Inline diagnostics** — errors and warnings displayed directly in the editor
- **Unicode input** — `\forall` → `∀`, `\R` → `ℝ`, etc., with a category-grouped symbol palette
- **Multi-device access** — work on Lean proofs from any browser on the LAN

### C++ Engineering

- **clangd LSP per session** — diagnostics, hover, completion, document symbols (rendered as an outline tree). Default `.clangd` config dropped automatically so single-file scratch work is fully featured before any build system exists.
- **CMake build pipeline** — auto-detected via `CMakeLists.txt`. Configure → build → run with parsed diagnostics surfaced as a clickable list.
- **Build flavors and sanitizers** — one-click switching between `Debug` / `Release` / `RelWithDebInfo` / `MinSizeRel`, optionally combined with `asan` / `tsan` / `ubsan` / `msan`. Each flavor lives in its own `build/<flavor>/` directory.
- **Build artifact browser** — tree view of `build/`: classify executables, objects, archives, shared libs, `compile_commands.json`. Inline view for text artifacts, download for binaries.
- **Build history** — every build is persisted with diagnostics; runs link back to the build that produced their binary.
- **Compiler Explorer integration** — pick a compiler from godbolt.org, view assembly for the current source side-by-side with the editor.
- **Single-file fallback** — sessions without `CMakeLists.txt` use a one-shot `g++ -O2 -std=c++20 -Wall -Wextra` compile-and-run path.
- **Persistent shell** — every freeform session has a real PTY-backed terminal in the right pane (multiple tabs supported, scrollback preserved across reconnects).

### Notebook Sessions

- **Jupyter-style cells** — Python code/markdown cells with output rendering (text/HTML/images)
- **Per-session kernel** — `ipykernel` driven by a small Python sidecar; auto-completion via the kernel
- **Notebook is a plain `.ipynb`** in the session working directory — interoperates with anything else that reads notebooks

### Freeform (Python / Julia)

- Run code with stdout/stderr capture, execution history, timing, exit codes
- Session-isolated working directories with a multi-file tree, file uploads, and folder operations

### Claude AI Integration

- **Error diagnosis** — auto-assembles diagnostics / build errors / runtime errors as context for Claude
- **Formalization help** (Lean) — translates informal math into Lean 4 proofs with Scribe context
- **Implementation help** — assists with algorithm and method implementation
- **Context auto-assembly** — current file, diagnostics, goal state, last build/run output, and linked Scribe nodes
- **Apply to editor** — one-click insertion of Claude's suggested code
- API key managed via the Settings modal

### General

- **Session-based workflow** — each session bundles code, outputs, notes, and cross-app links into a logged, searchable unit
- **Full-text search** across all sessions (SQLite FTS5)
- **Markdown + LaTeX notes** per session, KaTeX rendering
- **Activity heatmap** and statistics dashboard
- **Light/dark themes** with eight color schemes; adjustable editor font size
- **Cross-app links** to sibling tools (Navigate, Scribe, Monolith, Granary)

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, Vite 6, TypeScript 5, CodeMirror 6 (`lang-cpp`, `lang-python`, custom Lean), xterm.js, KaTeX, Recharts |
| Backend | Express 4, TypeScript 5, better-sqlite3, ws (WebSocket), node-pty, multer |
| LSP | Generic `lsp-bridge.ts` shared by Lean (`lean --server`) and C++ (`clangd`) |
| Build | CMake (Ninja preferred when available), GCC/Clang diagnostic parser |
| Notebooks | `ipykernel` driven by a Python sidecar (`jupyter-bridge.py`) |
| Styling | CSS Modules + CSS custom properties (no Tailwind) |

## Prerequisites

- **Node.js** (v18+)
- **Git**

For Lean sessions:
- **Lean 4** via [elan](https://github.com/leanprover/elan) toolchain manager
- **Lake** (bundled with Lean)

For C++ sessions:
- **clangd** (LLVM toolchain)
- **g++** with C++20 support
- **cmake** (and optionally **ninja** — auto-detected and preferred)

For notebook sessions:
- **Python 3** with **`ipykernel`** installed (`pip install ipykernel`)

For other freeform languages (optional):
- **Julia**

## Getting Started

```bash
# Clone the repository
git clone https://github.com/tzu-chen/pyramid.git
cd pyramid

# Install all dependencies (root + server + client)
npm run install:all

# Start development servers (frontend + backend)
npm run dev
```

The app will be available at:
- **Frontend:** http://localhost:5177
- **API server:** http://localhost:3007

Access from other devices on the LAN using your machine's IP address (e.g., `http://192.168.1.x:5177`).

### Production Build

```bash
# Build both client and server
npm run build

# Start production server (serves API + built frontend)
npm start
```

The production server runs on port 3007 and serves both the API and the built frontend. The build step copies `jupyter-bridge.py` into `dist/services/` so notebook kernels work without the source tree.

## Project Structure

```
pyramid/
├── package.json                # Root scripts (dev, build, install:all)
├── client/                     # React frontend (Vite)
│   ├── src/
│   │   ├── App.tsx             # Routing
│   │   ├── types.ts            # Shared TypeScript interfaces
│   │   ├── components/
│   │   │   ├── ArtifactBrowser/      # Build artifact tree
│   │   │   ├── BuildPanel/           # CMake configure/build UI + diagnostics
│   │   │   ├── ClaudePanel/          # Claude AI assistant
│   │   │   ├── CodeEditor/           # CodeMirror 6 wrapper, LSP integration
│   │   │   ├── CompilerExplorerPanel/# godbolt.org assembly view
│   │   │   ├── CsvViewer/            # Tabular preview for .csv data
│   │   │   ├── FileTree/             # Multi-file directory browser
│   │   │   ├── GoalStatePanel/       # Lean tactic goal state
│   │   │   ├── NotebookEditor/       # Jupyter cell editor
│   │   │   ├── OutlinePanel/         # clangd document symbols
│   │   │   ├── SymbolPalette/        # Lean Unicode picker
│   │   │   └── TerminalPane/         # xterm.js front-end for the PTY
│   │   ├── pages/              # Route-level pages
│   │   ├── services/           # REST + WebSocket clients
│   │   ├── hooks/              # useLeanLsp, useCppLsp, useNotebookKernel, useTerminal, ...
│   │   └── contexts/           # Theme, editor font size
│   └── vite.config.ts          # Proxy /api and /ws to port 3007
└── server/                     # Express backend
    ├── src/
    │   ├── index.ts            # Express app + WebSocket upgrade routing
    │   ├── db.ts               # SQLite schema + migrations
    │   ├── routes/             # REST endpoint handlers
    │   └── services/
    │       ├── lsp-bridge.ts       # Generic LSP-over-WebSocket relay
    │       ├── lean-lsp.ts         # Lean wrapper (lean --server)
    │       ├── lean-project.ts     # Lake project scaffolding
    │       ├── cpp-lsp.ts          # C++ wrapper (clangd)
    │       ├── cpp-project.ts      # Default .clangd config
    │       ├── cpp-build.ts        # CMake configure/build/run + artifact tree
    │       ├── execution.ts        # Single-file Python/Julia/C++/Lean runner
    │       ├── notebook-kernel.ts  # Jupyter kernel WebSocket relay
    │       ├── jupyter-bridge.py   # Python sidecar driving ipykernel
    │       ├── terminal.ts         # PTY-backed shells (node-pty)
    │       ├── godbolt.ts          # Compiler Explorer REST client
    │       ├── claude.ts           # Anthropic Messages API client
    │       └── scribe.ts           # Scribe cross-app proxy
    └── data/                   # Runtime data (gitignored)
        ├── pyramid.db          # SQLite database
        ├── sessions/           # Freeform & notebook session working dirs
        └── lean-projects/      # Lake projects (one per Lean session)
```

## How the LSP Bridge Works

A single generic class `LspBridge` (`server/src/services/lsp-bridge.ts`) handles every language server Pyramid talks to:

1. Spawns the LSP binary (`lean --server` or `clangd`) with the right working directory.
2. Reads `Content-Length`–framed JSON-RPC from the LSP's stdout, writes framed messages to its stdin.
3. Fans out to one or more browser clients connected over WebSocket.
4. Caches the `initialize` response so reconnecting clients don't trigger duplicate initializes (which most language servers crash on).
5. Shuts the LSP down cleanly after 30 minutes with no connected clients.

`lean-lsp.ts` and `cpp-lsp.ts` are 30-line wrappers that just specify the command, args, and `cwd`.

For Lean:

1. **Session creation** scaffolds a Lake project with `lakefile.toml`, `lean-toolchain`, and Mathlib. Prebuilt Mathlib artifacts are downloaded via `lake exe cache get` (cached globally to avoid re-downloading per session).
2. **Opening a session** spawns `lean --server` attached to the project. The process is shared by all clients viewing the session.
3. **Goal state** is fetched via `$/lean/plainGoal` requests on cursor movement and rendered with KaTeX.

For C++:

1. **Session creation** drops a default `.clangd` so single-file scratch sessions work immediately.
2. **CMake projects** (any session with `CMakeLists.txt` in its root) get an auto-symlinked `compile_commands.json` after each configure, so clangd sees real per-file flags.
3. **Document symbols** from `textDocument/documentSymbol` render as an outline tree.

## API Overview

All endpoints are under the `/api` prefix; WebSockets under `/ws`.

| Group | Endpoints | Description |
|-------|-----------|-------------|
| Sessions | `GET/POST/PUT/DELETE /api/sessions` | CRUD, FTS5 search, filter by type/status/language |
| Files | `GET/POST/PUT/PATCH/DELETE /api/sessions/:id/files`, `/folders`, `/upload`, `/tree` | File and folder management |
| Execution | `POST /api/sessions/:id/execute` | Single-file or CMake-aware execution |
| CMake | `POST /api/sessions/:id/cmake/{configure,build,clean}`, `GET /api/sessions/:id/cmake/{status,builds,binaries,artifacts}` | C++ project pipeline |
| Lean | `POST /api/lean/:id/build`, `WS /ws/lean/:id` | Lake build, LSP relay |
| C++ LSP | `WS /ws/cpp/:id` | clangd relay |
| Notebooks | `GET/POST /api/notebooks/:id/kernel`, `WS /ws/notebook/:id` | Jupyter kernel control + relay |
| Terminal | `WS /ws/terminal/:id/:tabId` | PTY relay (multiple tabs per session) |
| Compiler Explorer | `GET /api/godbolt/compilers`, `POST /api/godbolt/compile` | godbolt.org passthrough |
| Claude | `POST /api/sessions/:id/claude/ask` | AI assistant |
| Scribe Proxy | `GET /api/scribe/*` | Cross-app context from Scribe flowcharts |
| Stats | `/api/stats/overview`, `/api/stats/heatmap`, `/api/stats/languages` | Dashboard analytics |
| Settings | `GET/PUT /api/settings/:key` | User preferences (incl. Claude API key) |

## Environment

No `.env` files required. The only environment variable is `PORT` (defaults to 3007).

**Port assignments** (to avoid conflicts with sibling apps):
- Pyramid: 3007 (server), 5177 (Vite dev)
- Navigate: 3001/5173
- Scribe: 3003/5173
- Monolith: 3005/5173
- Granary: 3009/5174

## Related Projects

Pyramid is part of a personal research tooling ecosystem:

- **[Navigate](https://github.com/tzu-chen/navigate)** — arXiv paper management + AI chat
- **[Scribe](https://github.com/tzu-chen/scribe)** — Study tool: PDFs, notes, flowcharts, questions
- **[Monolith](https://github.com/tzu-chen/monolith)** — Local LaTeX editor with Tectonic backend
- **[Granary](https://github.com/tzu-chen/granary)** — Research log, spaced repetition, inbox

All five apps share the same tech stack (React + Vite + Express + SQLite) and conventions.

## License

[MIT](LICENSE)
