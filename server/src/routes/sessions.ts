import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import db from '../db.js';
import { parseProblemUrl, downloadTestCases } from '../services/oj.js';

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

    const result: Record<string, unknown> = { ...formatSession(session), files, runs };

    if (session.session_type === 'cp') {
      const problem = db.prepare('SELECT * FROM cp_problems WHERE session_id = ?').get(req.params.id) as Record<string, unknown> | undefined;
      if (problem) {
        result.problem = { ...problem, topics: parseJsonField(problem.topics as string) };
        const testCases = db.prepare('SELECT * FROM test_cases WHERE problem_id = ? ORDER BY is_sample DESC, created_at ASC').all(problem.id as string);
        result.test_cases = testCases;
      }
    }

    if (session.session_type === 'repo') {
      const repo = db.prepare('SELECT * FROM repo_explorations WHERE session_id = ?').get(req.params.id) as Record<string, unknown> | undefined;
      if (repo) {
        result.repo = { ...repo, interesting_files: parseJsonField(repo.interesting_files as string) };
      }
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/sessions
router.post('/', async (req: Request, res: Response) => {
  try {
    const { title, session_type = 'freeform', language = 'python', tags = [], links = [], problem_url, repo_url } = req.body;

    if (!title) {
      res.status(400).json({ error: 'Title is required' });
      return;
    }

    const id = uuidv4();
    const now = getCstTimestamp();
    const workingDir = path.join('data', 'sessions', id);
    const absWorkingDir = path.join(__dirname, '..', '..', workingDir);
    fs.mkdirSync(absWorkingDir, { recursive: true });

    db.prepare(`
      INSERT INTO sessions (id, title, session_type, language, tags, status, links, notes, working_dir, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, '', ?, ?, ?)
    `).run(id, title, session_type, language, JSON.stringify(tags), JSON.stringify(links), workingDir, now, now);

    // Create default file based on language
    const ext = language === 'cpp' ? 'cpp' : language === 'julia' ? 'jl' : language === 'lean' ? 'lean' : 'py';
    const defaultFilename = session_type === 'cp' ? `solution.${ext}` : `main.${ext}`;
    const fileId = uuidv4();

    db.prepare(`
      INSERT INTO session_files (id, session_id, filename, file_type, language, is_primary, created_at, updated_at)
      VALUES (?, ?, ?, 'source', ?, 1, ?, ?)
    `).run(fileId, id, defaultFilename, language, now, now);

    fs.writeFileSync(path.join(absWorkingDir, defaultFilename), '');

    // Handle CP session
    if (session_type === 'cp' && problem_url) {
      const parsed = parseProblemUrl(problem_url);
      const problemId = uuidv4();

      db.prepare(`
        INSERT INTO cp_problems (id, session_id, judge, problem_url, problem_id, problem_name, topics, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, '', '[]', ?, ?)
      `).run(problemId, id, parsed.judge, problem_url, parsed.problem_id, now, now);

      // Try to download test cases in background
      downloadTestCases(problem_url, absWorkingDir).then(testCases => {
        for (const tc of testCases) {
          const tcId = uuidv4();
          const tcNow = getCstTimestamp();
          db.prepare(`
            INSERT INTO test_cases (id, problem_id, input, expected_output, is_sample, created_at)
            VALUES (?, ?, ?, ?, 1, ?)
          `).run(tcId, problemId, tc.input, tc.expected_output, tcNow);
        }
      }).catch(() => { /* oj not available or failed */ });
    }

    // Handle Repo session
    if (session_type === 'repo' && repo_url) {
      const repoName = repo_url.replace(/\.git$/, '').split('/').slice(-2).join('/');
      const repoId = uuidv4();
      const clonePath = path.join('data', 'repos', repoName.replace('/', '_'));

      db.prepare(`
        INSERT INTO repo_explorations (id, session_id, repo_url, repo_name, clone_path, branch, readme_summary, interesting_files, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'main', '', '[]', ?, ?)
      `).run(repoId, id, repo_url, repoName, clonePath, now, now);

      // Clone in background
      const { exec } = require('child_process');
      const absClonePath = path.join(__dirname, '..', '..', clonePath);
      if (!fs.existsSync(absClonePath)) {
        exec(`git clone --depth 1 "${repo_url}" "${absClonePath}"`, { timeout: 60000 }, () => {});
      }
    }

    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Record<string, unknown>;
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

    // Delete working directory
    const absDir = path.join(__dirname, '..', '..', session.working_dir as string);
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
