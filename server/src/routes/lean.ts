import { Router, Request, Response } from 'express';
import db from '../db.js';
import { leanProject } from '../services/lean-project.js';

const router = Router();

// GET /api/lean/:sessionId/meta
router.get('/:sessionId/meta', (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId as string;
    const meta = db.prepare('SELECT * FROM lean_session_meta WHERE session_id = ?').get(sessionId);
    if (!meta) {
      res.status(404).json({ error: 'Lean session metadata not found' });
      return;
    }
    res.json(meta);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/lean/:sessionId/build
router.post('/:sessionId/build', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId as string;
    const meta = db.prepare('SELECT * FROM lean_session_meta WHERE session_id = ?').get(sessionId);
    if (!meta) {
      res.status(404).json({ error: 'Lean session metadata not found' });
      return;
    }

    const result = await leanProject.build(sessionId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/lean/:sessionId/build-output
router.get('/:sessionId/build-output', (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId as string;
    const meta = db.prepare('SELECT last_build_output, last_build_at, lake_status FROM lean_session_meta WHERE session_id = ?')
      .get(sessionId) as { last_build_output: string; last_build_at: string | null; lake_status: string } | undefined;
    if (!meta) {
      res.status(404).json({ error: 'Lean session metadata not found' });
      return;
    }
    res.json(meta);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
