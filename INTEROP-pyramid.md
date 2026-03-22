# Pyramid — INTEROP.md

Cross-app integration spec for Pyramid. This documents the endpoints and data shapes that sibling apps (Navigate, Scribe, Monolith, Granary) may call or reference.

**Base URL:** `http://localhost:3007/api`
**Port:** 3007 (server), 5177 (Vite dev)

---

## Data Available to Other Apps

### Sessions

Pyramid is the source of truth for computational experiments, CP practice, repo explorations, and Lean proofs.

**List sessions (with filtering):**

```
GET /api/sessions?session_type=<type>&status=<status>&language=<lang>&tag=<tag>&search=<query>
```

All query params are optional and combinable. When `search` is present, results are ranked by FTS5/BM25 relevance; otherwise newest-first.

Returns:

```
interface Session {
  id: string;              // UUID
  title: string;
  session_type: 'freeform' | 'cp' | 'repo' | 'lean';
  language: string;        // 'python' | 'julia' | 'cpp' | 'lean' | 'mixed'
  tags: string[];          // JSON array stored as TEXT
  status: 'active' | 'paused' | 'completed' | 'archived';
  links: SessionLink[];    // JSON array stored as TEXT (see below)
  notes: string;           // Markdown+LaTeX session notes
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

**Get a single session (with files, runs, and type-specific data):**

```
GET /api/sessions/:id
```

**Create a session:**

```
POST /api/sessions
```

Body: `{ title, session_type, language, tags?, links?, problem_url?, repo_url? }`. Auto-creates working directory. For CP sessions with `problem_url`, auto-fetches test cases via `oj`.

### Session Files

**List files in a session:**

```
GET /api/sessions/:id/files
```

**Read file content:**

```
GET /api/sessions/:id/files/:fileId/content
```

Returns plain text content.

**Write file content:**

```
PUT /api/sessions/:id/files/:fileId/content
```

Body: `{ content: string }`.

### Execution Runs

**List runs for a session:**

```
GET /api/sessions/:id/runs?limit=50
```

Returns:

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
}
```

**Execute code:**

```
POST /api/sessions/:id/execute
```

Body: `{ file_id?, timeout_ms?, stdin? }`. Spawns child process, captures output, logs the run.

### CP Problems

**List all CP problems (across sessions):**

```
GET /api/cp/problems?judge=<judge>&verdict=<verdict>&topic=<topic>
```

Returns:

```
interface CpProblem {
  id: string;
  session_id: string;
  judge: string;               // 'codeforces' | 'atcoder' | 'leetcode' | 'other'
  problem_url: string;
  problem_id: string;
  problem_name: string;
  difficulty: string | null;
  topics: string[];            // JSON array
  verdict: 'unsolved' | 'accepted' | 'wrong_answer' | 'time_limit' | 'runtime_error' | 'attempted';
  attempts: number;
  solved_at: string | null;
  editorial_notes: string;
  created_at: string;
  updated_at: string;
}
```

**Test cases for a problem:**

```
GET /api/cp/problems/:id/tests
```

### Repo Explorations

**List all repo explorations:**

```
GET /api/repos
```

Returns:

```
interface RepoExploration {
  id: string;
  session_id: string;
  repo_url: string;
  repo_name: string;           // "owner/repo"
  clone_path: string;
  branch: string;
  readme_summary: string;
  interesting_files: string[];
  created_at: string;
  updated_at: string;
}
```

**Browse cloned repo files:**

```
GET /api/repos/:id/tree
GET /api/repos/:id/file?path=<relative_path>
```

### Stats

```
GET /api/stats/overview             → sessions by type, active count, total runs, CP solve rate
GET /api/stats/heatmap?start=&end=  → execution run counts by date
GET /api/stats/cp                   → CP problems by verdict, judge, topic, solve rate over time
GET /api/stats/languages            → runs by language breakdown
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
// In Granary — proposed extension to EntryLink
{
  app: 'pyramid',
  ref_type: 'session_id',
  ref_id: '<session UUID>',
  label: 'SPDE finite element experiment'
}
```

---

## Integration Points for Other Apps

### Navigate → Pyramid: Paper Reproduction

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

### Scribe → Pyramid: Textbook Exercise

Create a freeform session linked to a flowchart node:

```
POST /api/sessions
Body: {
  title: "Exercise: <node title>",
  session_type: "freeform",
  language: "julia",
  links: [{ app: "scribe", ref_type: "flowchart_node", ref_id: "Hahn-Banach Theorem" }]
}
```

### Granary Inbox → Pyramid: Repo Exploration

Create a repo session from an inbox item:

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

### Reading Pyramid State

To check what the user is currently working on:

```
GET /api/sessions?status=active   → active sessions
GET /api/stats/overview           → summary counts
GET /api/cp/problems?verdict=accepted  → solved CP problems
```

---

## Planned Endpoints for Cross-App Use (Not Yet Implemented)

| Consumer | Endpoint | Purpose |
|----------|----------|---------|
| Navigate | `POST /api/sessions` | "Try this" — create a freeform session pre-linked to a paper |
| Scribe | `POST /api/sessions` | "Try this" — create a freeform session pre-linked to a flowchart node |
| Granary | `GET /api/sessions/:id` | Fetch session metadata for display in entry detail view (link preview) |
| Granary | `GET /api/cp/problems?verdict=accepted` | Pull solved CP problems for potential promotion to review cards |
| Granary | `GET /api/stats/heatmap` | Aggregate Pyramid activity into Granary's dashboard |
| Monolith | `GET /api/sessions/:id/files/:fileId/content` | Pull code snippets to include in LaTeX documents |
