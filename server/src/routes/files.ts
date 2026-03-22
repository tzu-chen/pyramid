import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import db from '../db.js';

const router = Router();

function getCstTimestamp(): string {
  const now = new Date();
  const cst = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  return cst.toISOString().replace('Z', '-06:00');
}

// GET /api/sessions/:id/files
router.get('/:id/files', (req: Request, res: Response) => {
  try {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const files = db.prepare('SELECT * FROM session_files WHERE session_id = ? ORDER BY is_primary DESC, created_at ASC').all(req.params.id);
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/sessions/:id/files/:fileId
router.get('/:id/files/:fileId', (req: Request, res: Response) => {
  try {
    const file = db.prepare('SELECT * FROM session_files WHERE id = ? AND session_id = ?').get(req.params.fileId, req.params.id);
    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    res.json(file);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/sessions/:id/files/:fileId/content
router.get('/:id/files/:fileId/content', (req: Request, res: Response) => {
  try {
    const file = db.prepare('SELECT * FROM session_files WHERE id = ? AND session_id = ?').get(req.params.fileId, req.params.id) as Record<string, unknown> | undefined;
    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as Record<string, unknown>;
    const filePath = path.join(__dirname, '..', '..', session.working_dir as string, file.filename as string);

    if (!fs.existsSync(filePath)) {
      res.type('text/plain').send('');
      return;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    res.type('text/plain').send(content);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/sessions/:id/files
router.post('/:id/files', (req: Request, res: Response) => {
  try {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const { filename, language = '', content = '', is_primary = false, file_type = 'source' } = req.body;
    if (!filename) {
      res.status(400).json({ error: 'Filename is required' });
      return;
    }

    const id = uuidv4();
    const now = getCstTimestamp();

    // If this file is primary, unset any existing primary
    if (is_primary) {
      db.prepare('UPDATE session_files SET is_primary = 0 WHERE session_id = ?').run(req.params.id);
    }

    db.prepare(`
      INSERT INTO session_files (id, session_id, filename, file_type, language, is_primary, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.params.id, filename, file_type, language, is_primary ? 1 : 0, now, now);

    // Write content to disk
    const filePath = path.join(__dirname, '..', '..', session.working_dir as string, filename);
    fs.writeFileSync(filePath, content);

    const file = db.prepare('SELECT * FROM session_files WHERE id = ?').get(id);
    res.status(201).json(file);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// PUT /api/sessions/:id/files/:fileId/content
router.put('/:id/files/:fileId/content', (req: Request, res: Response) => {
  try {
    const file = db.prepare('SELECT * FROM session_files WHERE id = ? AND session_id = ?').get(req.params.fileId, req.params.id) as Record<string, unknown> | undefined;
    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as Record<string, unknown>;
    const { content } = req.body;
    if (content === undefined) {
      res.status(400).json({ error: 'Content is required' });
      return;
    }

    const filePath = path.join(__dirname, '..', '..', session.working_dir as string, file.filename as string);
    fs.writeFileSync(filePath, content);

    const now = getCstTimestamp();
    db.prepare('UPDATE session_files SET updated_at = ? WHERE id = ?').run(now, req.params.fileId);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// DELETE /api/sessions/:id/files/:fileId
router.delete('/:id/files/:fileId', (req: Request, res: Response) => {
  try {
    const file = db.prepare('SELECT * FROM session_files WHERE id = ? AND session_id = ?').get(req.params.fileId, req.params.id) as Record<string, unknown> | undefined;
    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as Record<string, unknown>;
    const filePath = path.join(__dirname, '..', '..', session.working_dir as string, file.filename as string);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    db.prepare('DELETE FROM session_files WHERE id = ?').run(req.params.fileId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
