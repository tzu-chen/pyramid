import { Router, Request, Response } from 'express';
import db from '../db.js';
import { notebookKernel } from '../services/notebook-kernel.js';

const router = Router();

// GET /api/notebooks/:sessionId/kernel
router.get('/:sessionId/kernel', (req: Request, res: Response) => {
  try {
    const session = db.prepare('SELECT session_type FROM sessions WHERE id = ?').get(req.params.sessionId as string) as { session_type: string } | undefined;
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (session.session_type !== 'notebook') {
      res.status(400).json({ error: 'Not a notebook session' });
      return;
    }
    res.json({ running: notebookKernel.isRunning(req.params.sessionId as string) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/notebooks/:sessionId/kernel/stop
router.post('/:sessionId/kernel/stop', (req: Request, res: Response) => {
  try {
    notebookKernel.stopKernel(req.params.sessionId as string);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
