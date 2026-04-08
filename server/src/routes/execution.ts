import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import db from '../db.js';
import { executeFile } from '../services/execution.js';

const router = Router();

function getCstTimestamp(): string {
  const now = new Date();
  const cst = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  return cst.toISOString().replace('Z', '-06:00');
}

// GET /api/sessions/:id/runs
router.get('/:id/runs', (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const runs = db.prepare('SELECT * FROM execution_runs WHERE session_id = ? ORDER BY created_at DESC LIMIT ?').all(req.params.id, limit);
    res.json(runs);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/sessions/:id/runs/:runId
router.get('/:id/runs/:runId', (req: Request, res: Response) => {
  try {
    const run = db.prepare('SELECT * FROM execution_runs WHERE id = ? AND session_id = ?').get(req.params.runId, req.params.id);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    res.json(run);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/sessions/:id/execute
router.post('/:id/execute', async (req: Request, res: Response) => {
  try {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const { file_id, timeout_ms, stdin } = req.body;

    let file: Record<string, unknown> | undefined;
    if (file_id) {
      file = db.prepare('SELECT * FROM session_files WHERE id = ? AND session_id = ?').get(file_id, req.params.id) as Record<string, unknown> | undefined;
    } else {
      file = db.prepare('SELECT * FROM session_files WHERE session_id = ? AND is_primary = 1').get(req.params.id) as Record<string, unknown> | undefined;
    }

    if (!file) {
      res.status(404).json({ error: 'No file to execute' });
      return;
    }

    const absWorkingDir = path.join(__dirname, '..', '..', session.working_dir as string);
    const language = (file.language as string) || (session.language as string);

    const defaultTimeout = 30000;
    const result = await executeFile(absWorkingDir, file.filename as string, language, {
      timeout_ms: timeout_ms || defaultTimeout,
      stdin,
    });

    const runId = uuidv4();
    const now = getCstTimestamp();

    db.prepare(`
      INSERT INTO execution_runs (id, session_id, file_id, command, exit_code, stdout, stderr, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(runId, req.params.id, file.id as string, result.command, result.exit_code, result.stdout, result.stderr, result.duration_ms, now);

    const run = db.prepare('SELECT * FROM execution_runs WHERE id = ?').get(runId);
    res.json(run);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
