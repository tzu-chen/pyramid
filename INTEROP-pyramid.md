# Pyramid — INTEROP.md

Cross-app integration spec for Pyramid. This documents the endpoints and data shapes that sibling apps (Navigate, Scribe, Monolith, Granary) may call or reference.

**Base URL:** `http://localhost:3007/api`
**WebSocket:** `ws://localhost:3007/ws`
**Port:** 3007 (server), 5177 (Vite dev)

---

## Data Available to Other Apps

### Sessions

Pyramid is the source of truth for computational experiments, Lean proofs, CP practice, and repo explorations.

**List sessions (with filtering):**

```
GET /api/sessions?session_type=<type>&status=<status>&language=<lang>&tag=<tag>&search=<query>
```

All query params optional and combinable. Returns:

```
interface Session {
  id: string;              // UUID
  title: string;
  session_type: 'lean' | 'freeform' | 'cp' | 'repo';
  language: string;        // 'lean' | 'python' | 'julia' | 'cpp' | 'mixed'
  tags: string[];          // JSON array stored as TEXT
  status: 'active' | 'paused' | 'completed' | 'archived';
  links: SessionLink[];    // JSON array stored as TEXT (see below)
  notes: string;           // Markdown+LaTeX
  working_dir: string;
  created_at: string;      // ISO 8601
  updated_at: string;
}

interface SessionLink {
  app: 'navigate' | 'scribe' | 'monolith' | 'granary';
  ref_type: 'arxiv_id' | 'paper_id' | 'note_id' | 'flowchart_node' | 'project' | 'entry_id';
  ref_id: string;
  label?: string;
}
```

**Get a single session:**

```
GET /api/sessions/:id
```

Returns session with files, type-specific data (Lean meta, CP problem, or repo exploration), and recent runs.

**Create a session:**

```
POST /api/sessions
```

Body: `{ title, session_type, language, tags?, links?, problem_url?, repo_url? }`. For `lean` sessions: scaffolds a Lake project with Mathlib and runs `lake exe cache get`. For `cp` with `problem_url`: fetches test cases via `oj`. For `repo` with `repo_url`: clones the repository.

### Lean Session Metadata

**Get Lean-specific metadata:**

```
GET /api/lean/:sessionId/meta
```

Returns:

```
interface LeanSessionMeta {
  id: string;
  session_id: string;
  lean_version: string;          // e.g., "leanprover/lean4:v4.16.0"
  mathlib_version: string;
  project_path: string;
  lake_status: 'initializing' | 'ready' | 'building' | 'error';
  last_build_output: string;
  last_build_at: string | null;
  created_at: string;
  updated_at: string;
}
```

**Trigger a build:**

```
POST /api/lean/:sessionId/build
```

### Lean LSP WebSocket

```
WebSocket: ws://localhost:3007/ws/lean/:sessionId
```

Bidirectional LSP JSON-RPC relay between the browser and the Lean Language Server. The backend spawns `lean --server` for the session's Lake project and proxies messages transparently.

### Session Files

**List files:**

```
GET /api/sessions/:id/files
```

**Read file content:**

```
GET /api/sessions/:id/files/:fileId/content
```

**Write file content:**

```
PUT /api/sessions/:id/files/:fileId/content
```

Body: `{ content: string }`.

### Execution Runs (freeform/CP only)

**List runs:**

```
GET /api/sessions/:id/runs?limit=50
```

Returns `ExecutionRun[]` with command, exit code, stdout, stderr, duration.

**Execute code:**

```
POST /api/sessions/:id/execute
```

Body: `{ file_id?, timeout_ms?, stdin? }`.

### CP Problems

**List all CP problems:**

```
GET /api/cp/problems?judge=<judge>&verdict=<verdict>&topic=<topic>
```

Returns `CpProblem[]` with judge, problem ID, name, difficulty, topics, verdict, attempts.

**Test cases:**

```
GET /api/cp/problems/:id/tests
```

### Repo Explorations

**List repos:**

```
GET /api/repos
```

Returns `RepoExploration[]` with repo URL, name, branch, summary.

**Browse cloned files:**

```
GET /api/repos/:id/tree
GET /api/repos/:id/file?path=<relative_path>
```

### Stats

```
GET /api/stats/overview             → sessions by type, active count, total runs, CP solve rate
GET /api/stats/heatmap?start=&end=  → activity counts by date
GET /api/stats/cp                   → CP problems by verdict, judge, topic
GET /api/stats/languages            → runs by language
```

### Settings

```
GET /api/settings
GET /api/settings/:key
PUT /api/settings/:key              → Body: { value: string }
```

---

## Cross-App Reference Keys

When other apps link to Pyramid entities, use these identifiers:

| Entity | Key | Example |
|--------|-----|---------|
| Session | `id` (UUID string) | `"a1b2c3d4-..."` |
| CP Problem | `id` (UUID string) | `"e5f6g7h8-..."` |
| Repo Exploration | `id` (UUID string) | `"i9j0k1l2-..."` |

### How Pyramid References Other Apps

Pyramid sessions store cross-app links in the `links` JSON field:

| Target App | ref_type | ref_id | Example |
|------------|----------|--------|---------|
| Navigate | `arxiv_id` | arXiv ID string | `"2301.12345"` |
| Navigate | `paper_id` | Navigate internal paper ID | `"42"` |
| Scribe | `note_id` | Scribe note UUID | `"a1b2c3d4-..."` |
| Scribe | `flowchart_node` | Flowchart node title | `"Hahn-Banach Theorem"` |
| Monolith | `project` | Project directory name | `"mfg-paper"` |
| Granary | `entry_id` | Granary entry UUID | `"b2c3d4e5-..."` |

### How Other Apps Reference Pyramid

Granary's `EntryLink` type should be extended to include `'pyramid'` as an `app` value and `'session_id'` as a `ref_type`:

```
{
  app: 'pyramid',
  ref_type: 'session_id',
  ref_id: '<session UUID>',
  label: 'Hahn-Banach formalization'
}
```

---

## Integration Points for Other Apps

### Navigate → Pyramid: Formalize a Result

Create a Lean session pre-linked to a paper:

```
POST /api/sessions
Body: {
  title: "Formalize: <theorem from paper>",
  session_type: "lean",
  language: "lean",
  links: [{ app: "navigate", ref_type: "arxiv_id", ref_id: "2301.12345", label: "<paper title>" }]
}
```

### Navigate → Pyramid: Reproduce a Computation

Create a freeform session pre-linked to a paper:

```
POST /api/sessions
Body: {
  title: "Reproduce: <paper title>",
  session_type: "freeform",
  language: "python",
  links: [{ app: "navigate", ref_type: "arxiv_id", ref_id: "2301.12345", label: "<paper title>" }]
}
```

### Scribe → Pyramid: Formalize a Textbook Theorem

Create a Lean session linked to a flowchart node:

```
POST /api/sessions
Body: {
  title: "Formalize: <theorem name>",
  session_type: "lean",
  language: "lean",
  links: [{ app: "scribe", ref_type: "flowchart_node", ref_id: "Hahn-Banach Theorem" }]
}
```

### Granary Inbox → Pyramid: Repo Exploration

```
POST /api/sessions
Body: {
  title: "Explore: <repo name>",
  session_type: "repo",
  language: "python",
  repo_url: "https://github.com/owner/repo",
  links: [{ app: "granary", ref_type: "entry_id", ref_id: "<inbox entry UUID>" }]
}
```

### Monolith → Pyramid: Pull Formalized Results

Read Lean source to reference in a LaTeX paper:

```
GET /api/sessions/:id/files/:fileId/content
```

### Reading Pyramid State

```
GET /api/sessions?status=active        → active sessions
GET /api/sessions?session_type=lean    → all Lean sessions
GET /api/stats/overview                → summary counts
```

---

## Planned Endpoints for Cross-App Use (Not Yet Implemented)

| Consumer | Endpoint | Purpose |
|----------|----------|---------|
| Navigate | `POST /api/sessions` | "Formalize this" / "Try this" — create a session pre-linked to a paper |
| Scribe | `POST /api/sessions` | "Formalize this" — create a Lean session linked to a flowchart node |
| Granary | `GET /api/sessions/:id` | Fetch session metadata for link preview in entry detail view |
| Granary | `GET /api/cp/problems?verdict=accepted` | Pull solved CP problems for promotion to review cards |
| Granary | `GET /api/stats/heatmap` | Aggregate Pyramid activity into Granary's dashboard |
| Monolith | `GET /api/sessions/:id/files/:fileId/content` | Pull formalized Lean statements for inclusion in LaTeX |
