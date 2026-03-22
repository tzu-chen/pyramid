import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import db from '../db.js';
import { executeFile } from '../services/execution.js';
import { downloadTestCases } from '../services/oj.js';

const router = Router();

function getCstTimestamp(): string {
  const now = new Date();
  const cst = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  return cst.toISOString().replace('Z', '-06:00');
}

function parseJsonField(value: string): unknown {
  try { return JSON.parse(value); } catch { return value; }
}

// GET /api/cp/problems
router.get('/problems', (req: Request, res: Response) => {
  try {
    const { judge, verdict, topic, difficulty } = req.query;
    let query = 'SELECT cp.*, s.title as session_title, s.language FROM cp_problems cp JOIN sessions s ON cp.session_id = s.id WHERE 1=1';
    const params: unknown[] = [];

    if (judge) { query += ' AND cp.judge = ?'; params.push(judge); }
    if (verdict) { query += ' AND cp.verdict = ?'; params.push(verdict); }
    if (topic) { query += ' AND cp.topics LIKE ?'; params.push(`%"${topic}"%`); }
    if (difficulty) { query += ' AND cp.difficulty = ?'; params.push(difficulty); }

    query += ' ORDER BY cp.created_at DESC';
    const rows = db.prepare(query).all(...params) as Record<string, unknown>[];
    res.json(rows.map(r => ({ ...r, topics: parseJsonField(r.topics as string) })));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/cp/problems/:id
router.get('/problems/:id', (req: Request, res: Response) => {
  try {
    const problem = db.prepare('SELECT * FROM cp_problems WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
    if (!problem) {
      res.status(404).json({ error: 'Problem not found' });
      return;
    }

    const testCases = db.prepare('SELECT * FROM test_cases WHERE problem_id = ? ORDER BY is_sample DESC, created_at ASC').all(req.params.id);
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(problem.session_id as string);

    res.json({
      ...problem,
      topics: parseJsonField(problem.topics as string),
      test_cases: testCases,
      session,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// PUT /api/cp/problems/:id
router.put('/problems/:id', (req: Request, res: Response) => {
  try {
    const problem = db.prepare('SELECT * FROM cp_problems WHERE id = ?').get(req.params.id);
    if (!problem) {
      res.status(404).json({ error: 'Problem not found' });
      return;
    }

    const { topics, editorial_notes, verdict, problem_name, difficulty, attempts } = req.body;
    const now = getCstTimestamp();
    const updates: string[] = [];
    const params: unknown[] = [];

    if (topics !== undefined) { updates.push('topics = ?'); params.push(JSON.stringify(topics)); }
    if (editorial_notes !== undefined) { updates.push('editorial_notes = ?'); params.push(editorial_notes); }
    if (verdict !== undefined) {
      updates.push('verdict = ?');
      params.push(verdict);
      if (verdict === 'accepted') {
        updates.push('solved_at = ?');
        params.push(now);
      }
    }
    if (problem_name !== undefined) { updates.push('problem_name = ?'); params.push(problem_name); }
    if (difficulty !== undefined) { updates.push('difficulty = ?'); params.push(difficulty); }
    if (attempts !== undefined) { updates.push('attempts = ?'); params.push(attempts); }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    updates.push('updated_at = ?');
    params.push(now);
    params.push(req.params.id);

    db.prepare(`UPDATE cp_problems SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    const updated = db.prepare('SELECT * FROM cp_problems WHERE id = ?').get(req.params.id) as Record<string, unknown>;
    res.json({ ...updated, topics: parseJsonField(updated.topics as string) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/cp/problems/:id/test — run solution against all test cases
router.post('/problems/:id/test', async (req: Request, res: Response) => {
  try {
    const problem = db.prepare('SELECT * FROM cp_problems WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
    if (!problem) {
      res.status(404).json({ error: 'Problem not found' });
      return;
    }

    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(problem.session_id as string) as Record<string, unknown>;
    const primaryFile = db.prepare('SELECT * FROM session_files WHERE session_id = ? AND is_primary = 1').get(problem.session_id as string) as Record<string, unknown> | undefined;

    if (!primaryFile) {
      res.status(404).json({ error: 'No primary file to test' });
      return;
    }

    const testCases = db.prepare('SELECT * FROM test_cases WHERE problem_id = ? ORDER BY is_sample DESC, created_at ASC').all(req.params.id) as Record<string, unknown>[];

    const absWorkingDir = path.join(__dirname, '..', '..', session.working_dir as string);
    const language = (primaryFile.language as string) || (session.language as string);

    const results = [];
    for (const tc of testCases) {
      const result = await executeFile(absWorkingDir, primaryFile.filename as string, language, {
        timeout_ms: 10000,
        stdin: tc.input as string,
      });

      const actualOutput = result.stdout.trimEnd();
      const expectedOutput = (tc.expected_output as string).trimEnd();
      const passed = actualOutput === expectedOutput;

      results.push({
        test_case_id: tc.id,
        input: tc.input,
        expected_output: tc.expected_output,
        actual_output: result.stdout,
        passed,
        exit_code: result.exit_code,
        stderr: result.stderr,
        duration_ms: result.duration_ms,
      });
    }

    // Update attempts count
    const now = getCstTimestamp();
    db.prepare('UPDATE cp_problems SET attempts = attempts + 1, updated_at = ? WHERE id = ?').run(now, req.params.id);

    const allPassed = results.length > 0 && results.every(r => r.passed);
    res.json({ results, all_passed: allPassed });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/cp/problems/:id/fetch-tests
router.post('/problems/:id/fetch-tests', async (req: Request, res: Response) => {
  try {
    const problem = db.prepare('SELECT * FROM cp_problems WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
    if (!problem) {
      res.status(404).json({ error: 'Problem not found' });
      return;
    }

    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(problem.session_id as string) as Record<string, unknown>;
    const absWorkingDir = path.join(__dirname, '..', '..', session.working_dir as string);

    const testCases = await downloadTestCases(problem.problem_url as string, absWorkingDir);

    for (const tc of testCases) {
      const tcId = uuidv4();
      const now = getCstTimestamp();
      db.prepare(`
        INSERT INTO test_cases (id, problem_id, input, expected_output, is_sample, created_at)
        VALUES (?, ?, ?, ?, 1, ?)
      `).run(tcId, req.params.id, tc.input, tc.expected_output, now);
    }

    const allTests = db.prepare('SELECT * FROM test_cases WHERE problem_id = ? ORDER BY is_sample DESC, created_at ASC').all(req.params.id);
    res.json(allTests);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/cp/problems/:id/tests
router.get('/problems/:id/tests', (req: Request, res: Response) => {
  try {
    const tests = db.prepare('SELECT * FROM test_cases WHERE problem_id = ? ORDER BY is_sample DESC, created_at ASC').all(req.params.id);
    res.json(tests);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/cp/problems/:id/tests
router.post('/problems/:id/tests', (req: Request, res: Response) => {
  try {
    const problem = db.prepare('SELECT * FROM cp_problems WHERE id = ?').get(req.params.id);
    if (!problem) {
      res.status(404).json({ error: 'Problem not found' });
      return;
    }

    const { input, expected_output } = req.body;
    if (input === undefined || expected_output === undefined) {
      res.status(400).json({ error: 'Input and expected_output are required' });
      return;
    }

    const id = uuidv4();
    const now = getCstTimestamp();
    db.prepare(`
      INSERT INTO test_cases (id, problem_id, input, expected_output, is_sample, created_at)
      VALUES (?, ?, ?, ?, 0, ?)
    `).run(id, req.params.id, input, expected_output, now);

    const testCase = db.prepare('SELECT * FROM test_cases WHERE id = ?').get(id);
    res.status(201).json(testCase);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// DELETE /api/cp/problems/:id/tests/:testId
router.delete('/problems/:id/tests/:testId', (req: Request, res: Response) => {
  try {
    const testCase = db.prepare('SELECT * FROM test_cases WHERE id = ? AND problem_id = ?').get(req.params.testId, req.params.id);
    if (!testCase) {
      res.status(404).json({ error: 'Test case not found' });
      return;
    }

    db.prepare('DELETE FROM test_cases WHERE id = ?').run(req.params.testId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
