# Pyramid

A computational workbench for interactive **Lean 4 proof development** with full LSP integration and **freeform numerical/scientific computation** (Python/Julia/C++), accessible from any device — including iPad — via the browser. Includes built-in **Claude AI integration** for error diagnosis, formalization help, and implementation assistance.

## Features

### Lean 4 Proof Development (Primary)

- **Interactive proof environment** — Editor + tactic goal state panel + diagnostics, all in the browser
- **Full LSP integration** — The backend spawns a `lean --server` process per session and proxies LSP JSON-RPC messages over WebSocket
- **Mathlib support** — Each session gets a proper Lake project with Mathlib as a dependency and shared prebuilt artifact cache
- **Goal state panel** — Tactic goals rendered with KaTeX, updating live on cursor movement
- **Inline diagnostics** — Errors and warnings displayed directly in the editor
- **Multi-device access** — Work on Lean proofs from any browser on the local network, including iPad

### Freeform Code Execution

- Run Python 3, Julia, or C++ code with stdout/stderr capture
- Execution history with timing and exit codes
- Session-isolated working directories

### Claude AI Integration

- **Error diagnosis** — auto-assembles diagnostics/runtime errors as context for Claude
- **Formalization help** (Lean) — translates informal math into Lean 4 proofs with Scribe context
- **Implementation help** (freeform) — assists with algorithm and method implementation
- **Context auto-assembly** — current file, diagnostics, goal state, and linked Scribe nodes
- **Apply to editor** — one-click insertion of Claude's suggested code
- API key management via Settings modal

### General

- **Session-based workflow** — Each session bundles code, outputs, notes, and cross-app links into a logged, searchable unit
- **Full-text search** across all sessions (SQLite FTS5)
- **Markdown + LaTeX notes** per session with KaTeX rendering
- **Activity heatmap** and statistics dashboard
- **Light/dark themes** with 8 color schemes
- **Cross-app links** to sibling tools (Navigate, Scribe, Monolith, Granary)

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, Vite 6, TypeScript 5, CodeMirror 6, KaTeX, Recharts |
| Backend | Express 4, TypeScript 5, better-sqlite3, ws (WebSocket) |
| Lean Integration | Lean 4 LSP server, Lake build system, WebSocket JSON-RPC bridge |
| Styling | CSS Modules + CSS custom properties (no Tailwind) |

## Prerequisites

- **Node.js** (v18+)
- **Git**

For Lean sessions:
- **Lean 4** via [elan](https://github.com/leanprover/elan) toolchain manager
- **Lake** (bundled with Lean)

For freeform sessions (optional, based on language):
- **Python 3**
- **Julia**
- **g++** (with C++17 support)

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

The production server runs on port 3007 and serves both the API and the built frontend.

## Project Structure

```
pyramid/
├── package.json                # Root scripts (dev, build, install:all)
├── client/                     # React frontend (Vite)
│   ├── src/
│   │   ├── App.tsx             # Routing and global state
│   │   ├── types.ts            # Shared TypeScript interfaces
│   │   ├── components/         # Reusable UI (CodeEditor, GoalStatePanel, ClaudePanel, ...)
│   │   ├── pages/              # Route-level pages (Dashboard, SessionList, SessionPage, ...)
│   │   ├── services/           # API client layer (REST + WebSocket)
│   │   ├── hooks/              # Custom React hooks (useLeanLsp, useSession, ...)
│   │   └── contexts/           # Theme context
│   └── vite.config.ts          # Vite config with API/WS proxy to port 3007
└── server/                     # Express backend
    ├── src/
    │   ├── index.ts            # Express app + WebSocket server setup
    │   ├── db.ts               # SQLite schema and migrations
    │   ├── routes/             # REST endpoint handlers
    │   └── services/           # Business logic
    │       ├── execution.ts    # Child process spawning (Python/Julia/C++)
    │       ├── lean-lsp.ts     # Lean LSP server lifecycle + WebSocket relay
    │       ├── lean-project.ts # Lake project scaffolding and Mathlib cache
    │       ├── claude.ts       # Claude API client
    │       └── scribe.ts       # Scribe cross-app proxy
    └── data/                   # Runtime data (gitignored)
        ├── pyramid.db          # SQLite database
        ├── sessions/           # Session working directories
        └── lean-projects/      # Lake projects (one per Lean session)
```

## How Lean Integration Works

1. **Session creation** scaffolds a Lake project with `lakefile.toml`, `lean-toolchain`, and Mathlib dependency. Prebuilt Mathlib artifacts are downloaded via `lake exe cache get` (cached globally to avoid re-downloading).

2. **Opening a session** spawns a `lean --server` process attached to the session's Lake project. The process stays alive while the session is active.

3. **WebSocket bridge** at `ws://localhost:3007/ws/lean/:sessionId` transparently proxies LSP JSON-RPC messages between the browser and the Lean server. The backend does not interpret messages — it is a pass-through relay.

4. **The client** sends `textDocument/didOpen`, `textDocument/didChange`, and `Lean/plainGoal` requests as the user edits and moves the cursor. Diagnostics and goal state responses are rendered in real time.

5. **Idle timeout** stops the LSP process after 30 minutes of inactivity. It restarts transparently when the user returns.

## API Overview

All endpoints are under the `/api` prefix.

| Group | Endpoints | Description |
|-------|-----------|-------------|
| Sessions | `GET/POST/PUT/DELETE /api/sessions` | CRUD, search (FTS5), filter by type/status/language |
| Files | `GET/POST/PUT/DELETE /api/sessions/:id/files` | File metadata and content read/write |
| Execution | `POST /api/sessions/:id/execute` | Run code (Python/Julia/C++), get stdout/stderr |
| Lean | `POST /api/lean/:id/build`, `WS /ws/lean/:id` | Lake build trigger, LSP WebSocket relay |
| Claude | `POST /api/sessions/:id/claude/ask` | AI-assisted error diagnosis, formalization, implementation |
| Scribe Proxy | `GET /api/scribe/*` | Cross-app context from Scribe flowcharts |
| Stats | `/api/stats/overview`, `/api/stats/heatmap` | Activity and progress analytics |
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
