import { Router, Request, Response } from 'express';
import db from '../db.js';

const router = Router();

// GET /api/settings
router.get('/', (_req: Request, res: Response) => {
  try {
    const rows = db.prepare('SELECT * FROM settings').all() as Record<string, string>[];
    const settings: Record<string, string> = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/settings/:key
router.get('/:key', (req: Request, res: Response) => {
  try {
    const row = db.prepare('SELECT * FROM settings WHERE key = ?').get(req.params.key) as Record<string, string> | undefined;
    if (!row) {
      res.status(404).json({ error: 'Setting not found' });
      return;
    }
    res.json({ key: row.key, value: row.value });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// PUT /api/settings/:key
router.put('/:key', (req: Request, res: Response) => {
  try {
    const { value } = req.body;
    if (value === undefined) {
      res.status(400).json({ error: 'Value is required' });
      return;
    }

    db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(req.params.key, String(value));

    res.json({ key: req.params.key, value: String(value) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
