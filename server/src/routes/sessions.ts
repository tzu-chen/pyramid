import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import db from '../db.js';
import { LEAN_PROJECTS_DIR, resolveSessionCwd } from '../paths.js';
import { leanProject } from '../services/lean-project.js';
import { leanLsp } from '../services/lean-lsp.js';
import { cppLsp } from '../services/cpp-lsp.js';
import { cppProject } from '../services/cpp-project.js';
import { ocamlLsp } from '../services/ocaml-lsp.js';
import { ocamlProject } from '../services/ocaml-project.js';
import { ocamlDap } from '../services/ocaml-dap.js';
import { symlinkPath } from '../services/bc-fixup.js';
import { notebookKernel } from '../services/notebook-kernel.js';
import { pythonEnv } from '../services/python-env.js';
import { IGNORED_NAMES } from './files.js';
import { terminal } from '../services/terminal.js';
import { isFreeformType, languageForType } from '../session-types.js';

const router = Router();

function getCstTimestamp(): string {
  const now = new Date();
  const cst = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  return cst.toISOString().replace('Z', '-06:00');
}

function parseJsonField(value: string): unknown {
  try { return JSON.parse(value); } catch { return value; }
}

function formatSession(row: Record<string, unknown>) {
  return {
    ...row,
    tags: parseJsonField(row.tags as string),
    links: parseJsonField(row.links as string),
  };
}

// GET /api/sessions
router.get('/', (req: Request, res: Response) => {
  try {
    const { session_type, status, language, tag, search } = req.query;

    if (search && typeof search === 'string' && search.trim()) {
      // FTS5 search
      let query = `
        SELECT s.* FROM sessions s
        INNER JOIN sessions_fts fts ON s.rowid = fts.rowid
        WHERE sessions_fts MATCH ?
      `;
      const params: unknown[] = [search];

      if (session_type) { query += ' AND s.session_type = ?'; params.push(session_type); }
      if (status) { query += ' AND s.status = ?'; params.push(status); }
      if (language) { query += ' AND s.language = ?'; params.push(language); }
      if (tag) { query += ' AND s.tags LIKE ?'; params.push(`%"${tag}"%`); }

      query += ' ORDER BY rank';
      const rows = db.prepare(query).all(...params) as Record<string, unknown>[];
      res.json(rows.map(formatSession));
    } else {
      let query = 'SELECT * FROM sessions WHERE 1=1';
      const params: unknown[] = [];

      if (session_type) { query += ' AND session_type = ?'; params.push(session_type); }
      if (status) { query += ' AND status = ?'; params.push(status); }
      if (language) { query += ' AND language = ?'; params.push(language); }
      if (tag) { query += ' AND tags LIKE ?'; params.push(`%"${tag}"%`); }

      query += ' ORDER BY created_at DESC';
      const rows = db.prepare(query).all(...params) as Record<string, unknown>[];
      res.json(rows.map(formatSession));
    }
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/sessions/:id
router.get('/:id', (req: Request, res: Response) => {
  try {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const files = db.prepare('SELECT * FROM session_files WHERE session_id = ? ORDER BY is_primary DESC, created_at ASC').all(req.params.id);
    const runs = db.prepare('SELECT * FROM execution_runs WHERE session_id = ? ORDER BY created_at DESC LIMIT 20').all(req.params.id);

    const absWorkingDir = resolveSessionCwd(session.working_dir as string);
    const result: Record<string, unknown> = {
      ...formatSession(session),
      files,
      runs,
      absolute_working_dir: absWorkingDir,
    };

    if (session.session_type === 'lean') {
      const leanMeta = db.prepare('SELECT * FROM lean_session_meta WHERE session_id = ?').get(req.params.id);
      if (leanMeta) {
        const absProjectPath = path.join(LEAN_PROJECTS_DIR, req.params.id as string);
        result.lean_meta = { ...leanMeta as Record<string, unknown>, absolute_project_path: absProjectPath };
      }
    }

    if (session.session_type === 'python' || session.session_type === 'notebook') {
      const pyMeta = db.prepare('SELECT * FROM python_session_meta WHERE session_id = ?').get(req.params.id);
      if (pyMeta) result.python_meta = pyMeta;
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/sessions
router.post('/', async (req: Request, res: Response) => {
  try {
    const { title, session_type = 'python', tags = [], links = [], python_version } = req.body;

    if (!title) {
      res.status(400).json({ error: 'Title is required' });
      return;
    }

    // Language always mirrors the session type (python/cpp/ocaml/julia → same;
    // lean → 'lean'; notebook → 'python'), so callers only need to send the type.
    const language = languageForType(session_type);

    const id = uuidv4();
    const now = getCstTimestamp();

    // Lean sessions use lean-projects directory; others use sessions.
    // working_dir is stored relative to DATA_DIR (no "data/" prefix) so it
    // resolves correctly whether data lives in-repo or under SUITE_DATA_ROOT.
    const isLean = session_type === 'lean';
    const workingDir = isLean
      ? path.join('lean-projects', id)
      : path.join('sessions', id);
    const absWorkingDir = resolveSessionCwd(workingDir);
    fs.mkdirSync(absWorkingDir, { recursive: true });

    db.prepare(`
      INSERT INTO sessions (id, title, session_type, language, tags, status, links, notes, working_dir, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, '', ?, ?, ?)
    `).run(id, title, session_type, language, JSON.stringify(tags), JSON.stringify(links), workingDir, now, now);

    // Create default file based on session type / language
    const isNotebook = session_type === 'notebook';
    const ext = language === 'cpp' ? 'cpp' : language === 'julia' ? 'jl' : language === 'lean' ? 'lean' : language === 'ocaml' ? 'ml' : 'py';
    const defaultFilename = isLean ? 'Main.lean' : isNotebook ? 'notebook.ipynb' : `main.${ext}`;
    const fileId = uuidv4();
    const fileType = isNotebook ? 'source' : 'source';
    const fileLanguage = isNotebook ? 'python' : language;

    db.prepare(`
      INSERT INTO session_files (id, session_id, filename, file_type, language, is_primary, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `).run(fileId, id, defaultFilename, fileType, fileLanguage, now, now);

    if (isNotebook) {
      const emptyNb = {
        cells: [
          { cell_type: 'code', source: '', metadata: {}, outputs: [], execution_count: null, id: uuidv4() },
        ],
        metadata: {
          kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
          language_info: { name: 'python' },
        },
        nbformat: 4,
        nbformat_minor: 5,
      };
      fs.writeFileSync(path.join(absWorkingDir, defaultFilename), JSON.stringify(emptyNb, null, 1));
    } else if (!isLean) {
      fs.writeFileSync(path.join(absWorkingDir, defaultFilename), '');
    }

    // C++ freeform: drop a default .clangd so single-file LSP works out of the box
    if (!isLean && !isNotebook && language === 'cpp') {
      cppProject.ensureClangdConfig(absWorkingDir);
    }

    // OCaml freeform: drop a default .ocamlformat / .merlin so single-file LSP works
    if (!isLean && !isNotebook && language === 'ocaml') {
      ocamlProject.ensureDefaults(absWorkingDir);
    }

    // Handle Lean session: scaffold Lake project and insert metadata
    if (isLean) {
      const metaId = uuidv4();
      const leanVersion = 'leanprover/lean4:v4.16.0';
      db.prepare(`
        INSERT INTO lean_session_meta (id, session_id, lean_version, mathlib_version, project_path, lake_status, created_at, updated_at)
        VALUES (?, ?, ?, '', ?, 'initializing', ?, ?)
      `).run(metaId, id, leanVersion, workingDir, now, now);

      // Scaffold project in background (don't block response)
      leanProject.scaffoldProject(id).catch((err) => {
        console.error(`Failed to scaffold lean project for session ${id}:`, err);
      });
    }

    // Python / notebook: scaffold a uv project (pyproject + uv.lock + .venv) in
    // the background (no-op if uv is absent — execution falls back to system
    // python3). Notebooks add ipykernel as a dev dep so the kernel can launch
    // from the venv. Interpreter version: request → global setting → default.
    if ((session_type === 'python' || session_type === 'notebook') && pythonEnv.uvAvailable()) {
      const metaId = uuidv4();
      const version = pythonEnv.resolvePythonVersion(python_version);
      db.prepare(`
        INSERT INTO python_session_meta (id, session_id, python_version, venv_status, created_at, updated_at)
        VALUES (?, ?, ?, 'initializing', ?, ?)
      `).run(metaId, id, version, now, now);

      pythonEnv.scaffoldProject(id, workingDir, session_type === 'notebook', version).catch((err) => {
        console.error(`Failed to scaffold venv for session ${id}:`, err);
      });
    }

    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Record<string, unknown>;
    res.status(201).json(formatSession(session));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/sessions/:id/clone — duplicate a session: row + file metadata +
// working-dir contents (minus .venv/build/caches). For python/notebook the venv
// is rebuilt in the background from the copied uv.lock (exact via `uv sync`).
router.post('/:id/clone', (req: Request, res: Response) => {
  try {
    const src = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
    if (!src) { res.status(404).json({ error: 'Session not found' }); return; }
    if (src.session_type === 'lean') {
      res.status(400).json({ error: 'Lean sessions cannot be cloned (Lake project is session-specific)' });
      return;
    }

    const newId = uuidv4();
    const now = getCstTimestamp();
    const newWorkingDir = path.join('sessions', newId);
    const srcAbs = resolveSessionCwd(src.working_dir as string);
    const dstAbs = resolveSessionCwd(newWorkingDir);

    // Copy the working tree, skipping virtualenvs / build / cache dirs.
    fs.mkdirSync(dstAbs, { recursive: true });
    if (fs.existsSync(srcAbs)) {
      fs.cpSync(srcAbs, dstAbs, {
        recursive: true,
        filter: (s) => !IGNORED_NAMES.has(path.basename(s)),
      });
    }

    db.prepare(`
      INSERT INTO sessions (id, title, session_type, language, tags, status, links, notes, working_dir, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
    `).run(newId, `Copy of ${src.title}`, src.session_type, src.language, src.tags, src.links, src.notes, newWorkingDir, now, now);

    // Duplicate file metadata rows (content already copied on disk).
    const files = db.prepare('SELECT * FROM session_files WHERE session_id = ?').all(req.params.id) as Record<string, unknown>[];
    for (const f of files) {
      db.prepare(`
        INSERT INTO session_files (id, session_id, filename, file_type, language, is_primary, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(uuidv4(), newId, f.filename, f.file_type, f.language, f.is_primary, now, now);
    }

    // Python/notebook: rebuild the venv from the copied uv.lock in the background.
    if ((src.session_type === 'python' || src.session_type === 'notebook') && pythonEnv.uvAvailable()) {
      const srcMeta = db.prepare('SELECT python_version FROM python_session_meta WHERE session_id = ?')
        .get(req.params.id) as { python_version: string } | undefined;
      const version = pythonEnv.resolvePythonVersion(srcMeta?.python_version);
      db.prepare(`
        INSERT INTO python_session_meta (id, session_id, python_version, venv_status, created_at, updated_at)
        VALUES (?, ?, ?, 'initializing', ?, ?)
      `).run(uuidv4(), newId, version, now, now);
      pythonEnv.scaffoldProject(newId, newWorkingDir, src.session_type === 'notebook', version).catch((err) => {
        console.error(`Failed to rebuild venv for cloned session ${newId}:`, err);
      });
    }

    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(newId) as Record<string, unknown>;
    res.status(201).json(formatSession(session));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// PUT /api/sessions/:id
router.put('/:id', (req: Request, res: Response) => {
  try {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const { title, tags, notes, status, links, language } = req.body;
    const now = getCstTimestamp();
    const updates: string[] = [];
    const params: unknown[] = [];

    if (title !== undefined) { updates.push('title = ?'); params.push(title); }
    if (tags !== undefined) { updates.push('tags = ?'); params.push(JSON.stringify(tags)); }
    if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }
    if (links !== undefined) { updates.push('links = ?'); params.push(JSON.stringify(links)); }
    if (language !== undefined) { updates.push('language = ?'); params.push(language); }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    updates.push('updated_at = ?');
    params.push(now);
    params.push(req.params.id);

    db.prepare(`UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    const updated = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as Record<string, unknown>;
    res.json(formatSession(updated));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// DELETE /api/sessions/:id
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Stop Lean LSP if running and clean up lean project
    if (session.session_type === 'lean') {
      leanLsp.stopLsp(req.params.id as string);
      leanProject.deleteProject(req.params.id as string);
    }
    if (session.session_type === 'notebook') {
      notebookKernel.stopKernel(req.params.id as string);
    }
    if (isFreeformType(session.session_type as string)) {
      terminal.killSession(req.params.id as string);
      cppLsp.stopLsp(req.params.id as string);
      ocamlLsp.stopLsp(req.params.id as string);
      ocamlDap.stop(req.params.id as string);
      // Remove the per-session bytecode-debug symlink in /tmp (created by
      // bc-fixup post-build for OCaml debug). Safe to call for non-OCaml
      // sessions — it just no-ops if the symlink isn't present.
      try {
        const link = symlinkPath(req.params.id as string);
        if (fs.existsSync(link)) fs.unlinkSync(link);
      } catch { /* best-effort */ }
    }

    // Delete working directory
    const absDir = resolveSessionCwd(session.working_dir as string);
    if (fs.existsSync(absDir)) {
      fs.rmSync(absDir, { recursive: true, force: true });
    }

    db.prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// PATCH /api/sessions/:id/status
router.patch('/:id/status', (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    if (!['active', 'paused', 'completed', 'archived'].includes(status)) {
      res.status(400).json({ error: 'Invalid status' });
      return;
    }

    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const now = getCstTimestamp();
    db.prepare('UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?').run(status, now, req.params.id);
    const updated = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as Record<string, unknown>;
    res.json(formatSession(updated));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
