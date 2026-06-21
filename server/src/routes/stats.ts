import { Router, Request, Response } from 'express';
import db from '../db.js';

const router = Router();

// GET /api/stats/overview
router.get('/overview', (_req: Request, res: Response) => {
  try {
    const sessionsByType = db.prepare(`
      SELECT session_type, COUNT(*) as count FROM sessions GROUP BY session_type
    `).all();

    const activeCount = (db.prepare(`
      SELECT COUNT(*) as count FROM sessions WHERE status = 'active'
    `).get() as Record<string, number>).count;

    const totalRuns = (db.prepare(`
      SELECT COUNT(*) as count FROM execution_runs
    `).get() as Record<string, number>).count;

    res.json({
      sessions_by_type: sessionsByType,
      active_count: activeCount,
      total_runs: totalRuns,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/stats/heatmap
router.get('/heatmap', (req: Request, res: Response) => {
  try {
    const { start, end } = req.query;
    // Bucket by CST (UTC-6 fixed) calendar date, not UTC — created_at is stored
    // with a -06:00 offset, and SQLite's DATE() would otherwise normalize to UTC
    // and push evening runs onto the next day. Matches the app's CST convention.
    const cstDate = "DATE(created_at, '-6 hours')";
    let query = `
      SELECT ${cstDate} as date, COUNT(*) as count
      FROM execution_runs
    `;
    const params: unknown[] = [];

    if (start || end) {
      query += ' WHERE 1=1';
      if (start) { query += ` AND ${cstDate} >= ?`; params.push(start); }
      if (end) { query += ` AND ${cstDate} <= ?`; params.push(end); }
    }

    query += ` GROUP BY ${cstDate} ORDER BY date`;
    const rows = db.prepare(query).all(...params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/stats/languages
router.get('/languages', (_req: Request, res: Response) => {
  try {
    const rows = db.prepare(`
      SELECT s.language, COUNT(r.id) as count
      FROM execution_runs r
      JOIN sessions s ON r.session_id = s.id
      GROUP BY s.language
      ORDER BY count DESC
    `).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
