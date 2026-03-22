import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import db from '../db.js';

const router = Router();

function getCstTimestamp(): string {
  const now = new Date();
  const cst = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  return cst.toISOString().replace('Z', '-06:00');
}

function parseJsonField(value: string): unknown {
  try { return JSON.parse(value); } catch { return value; }
}

// GET /api/repos
router.get('/', (req: Request, res: Response) => {
  try {
    const rows = db.prepare(`
      SELECT r.*, s.title as session_title, s.status as session_status
      FROM repo_explorations r
      JOIN sessions s ON r.session_id = s.id
      ORDER BY r.created_at DESC
    `).all() as Record<string, unknown>[];

    res.json(rows.map(r => ({ ...r, interesting_files: parseJsonField(r.interesting_files as string) })));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/repos/:id
router.get('/:id', (req: Request, res: Response) => {
  try {
    const repo = db.prepare('SELECT * FROM repo_explorations WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
    if (!repo) {
      res.status(404).json({ error: 'Repo exploration not found' });
      return;
    }

    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(repo.session_id as string);
    res.json({
      ...repo,
      interesting_files: parseJsonField(repo.interesting_files as string),
      session,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// PUT /api/repos/:id
router.put('/:id', (req: Request, res: Response) => {
  try {
    const repo = db.prepare('SELECT * FROM repo_explorations WHERE id = ?').get(req.params.id);
    if (!repo) {
      res.status(404).json({ error: 'Repo exploration not found' });
      return;
    }

    const { readme_summary, interesting_files, branch } = req.body;
    const now = getCstTimestamp();
    const updates: string[] = [];
    const params: unknown[] = [];

    if (readme_summary !== undefined) { updates.push('readme_summary = ?'); params.push(readme_summary); }
    if (interesting_files !== undefined) { updates.push('interesting_files = ?'); params.push(JSON.stringify(interesting_files)); }
    if (branch !== undefined) { updates.push('branch = ?'); params.push(branch); }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    updates.push('updated_at = ?');
    params.push(now);
    params.push(req.params.id);

    db.prepare(`UPDATE repo_explorations SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    const updated = db.prepare('SELECT * FROM repo_explorations WHERE id = ?').get(req.params.id) as Record<string, unknown>;
    res.json({ ...updated, interesting_files: parseJsonField(updated.interesting_files as string) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/repos/:id/tree
router.get('/:id/tree', (req: Request, res: Response) => {
  try {
    const repo = db.prepare('SELECT * FROM repo_explorations WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
    if (!repo) {
      res.status(404).json({ error: 'Repo exploration not found' });
      return;
    }

    const absClonePath = path.join(__dirname, '..', '..', repo.clone_path as string);
    if (!fs.existsSync(absClonePath)) {
      res.json([]);
      return;
    }

    const relativePath = (req.query.path as string) || '';
    const targetDir = path.join(absClonePath, relativePath);

    if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
      res.json([]);
      return;
    }

    const entries = fs.readdirSync(targetDir, { withFileTypes: true })
      .filter(e => !e.name.startsWith('.'))
      .map(e => ({
        name: e.name,
        path: path.join(relativePath, e.name),
        type: e.isDirectory() ? 'directory' : 'file',
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/repos/:id/file
router.get('/:id/file', (req: Request, res: Response) => {
  try {
    const repo = db.prepare('SELECT * FROM repo_explorations WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
    if (!repo) {
      res.status(404).json({ error: 'Repo exploration not found' });
      return;
    }

    const filePath = req.query.path as string;
    if (!filePath) {
      res.status(400).json({ error: 'Path is required' });
      return;
    }

    const absPath = path.join(__dirname, '..', '..', repo.clone_path as string, filePath);

    // Prevent path traversal
    const normalizedPath = path.resolve(absPath);
    const normalizedBase = path.resolve(path.join(__dirname, '..', '..', repo.clone_path as string));
    if (!normalizedPath.startsWith(normalizedBase)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    if (!fs.existsSync(absPath) || fs.statSync(absPath).isDirectory()) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const content = fs.readFileSync(absPath, 'utf-8');
    res.type('text/plain').send(content);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
