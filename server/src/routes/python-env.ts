import { Router, Request, Response } from 'express';
import db from '../db.js';
import { resolveSessionCwd } from '../paths.js';
import { pythonEnv } from '../services/python-env.js';

const router = Router();

// Accept a package spec like `numpy`, `numpy>=1.0`, `uvicorn[standard]`. Reject
// anything that could be read as a uv flag or shell metacharacter.
const PKG_SPEC = /^[A-Za-z0-9][A-Za-z0-9._-]*(\[[A-Za-z0-9,._-]+\])?\s*([<>=!~].+)?$/;

interface SessionRow { working_dir: string; session_type: string }

function loadPySession(req: Request, res: Response): SessionRow | null {
  const row = db.prepare('SELECT working_dir, session_type FROM sessions WHERE id = ?')
    .get(req.params.sessionId as string) as SessionRow | undefined;
  if (!row) { res.status(404).json({ error: 'Session not found' }); return null; }
  if (row.session_type !== 'python' && row.session_type !== 'notebook') {
    res.status(400).json({ error: 'Not a python session' });
    return null;
  }
  if (!pythonEnv.uvAvailable()) { res.status(409).json({ error: 'uv is not available on the server' }); return null; }
  return row;
}

function metaVersion(sessionId: string): string {
  const m = db.prepare('SELECT python_version FROM python_session_meta WHERE session_id = ?')
    .get(sessionId) as { python_version: string } | undefined;
  return pythonEnv.resolvePythonVersion(m?.python_version);
}

// POST /api/python-env/cache/prune — must precede the /:sessionId routes.
router.post('/cache/prune', async (_req: Request, res: Response) => {
  try {
    if (!pythonEnv.uvAvailable()) { res.status(409).json({ error: 'uv is not available' }); return; }
    const r = await pythonEnv.pruneCache();
    if (r.exitCode !== 0) { res.status(500).json({ error: r.stderr.trim() || 'uv cache prune failed' }); return; }
    res.json({ ok: true, output: r.stdout.trim() });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/python-env/:sessionId/meta — venv scaffold status (polled while
// 'initializing'). 404 when uv is unavailable (no row), treated as system Python.
router.get('/:sessionId/meta', (req: Request, res: Response) => {
  try {
    const meta = db.prepare('SELECT * FROM python_session_meta WHERE session_id = ?')
      .get(req.params.sessionId as string) as Record<string, unknown> | undefined;
    if (!meta) {
      res.status(404).json({ error: 'No Python environment metadata for this session' });
      return;
    }
    res.json(meta);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/python-env/:sessionId/packages
router.get('/:sessionId/packages', async (req: Request, res: Response) => {
  try {
    const s = loadPySession(req, res); if (!s) return;
    res.json(await pythonEnv.listPackages(s.working_dir));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/python-env/:sessionId/packages  { name, dev? }
router.post('/:sessionId/packages', async (req: Request, res: Response) => {
  try {
    const s = loadPySession(req, res); if (!s) return;
    const { name, dev } = req.body as { name?: string; dev?: boolean };
    if (!name || typeof name !== 'string' || !PKG_SPEC.test(name.trim())) {
      res.status(400).json({ error: 'Invalid package name' });
      return;
    }
    const sessionId = req.params.sessionId as string;
    const dir = resolveSessionCwd(s.working_dir);
    const isNotebook = s.session_type === 'notebook';

    await pythonEnv.runExclusive(sessionId, async () => {
      // Lazily upgrade a pre-project (Tier-1) session to a uv project.
      if (!pythonEnv.isProjectReady(s.working_dir)) {
        await pythonEnv.buildProject(dir, isNotebook, metaVersion(sessionId));
      }
      const r = await pythonEnv.addPackage(dir, name.trim(), !!dev);
      if (r.exitCode !== 0) throw new Error(r.stderr.trim() || 'uv add failed');
    });

    db.prepare('UPDATE python_session_meta SET venv_status = ?, error_message = ?, updated_at = ? WHERE session_id = ?')
      .run('ready', '', new Date().toISOString(), sessionId);
    res.json(await pythonEnv.listPackages(s.working_dir));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// DELETE /api/python-env/:sessionId/packages/:name
router.delete('/:sessionId/packages/:name', async (req: Request, res: Response) => {
  try {
    const s = loadPySession(req, res); if (!s) return;
    const name = req.params.name as string;
    if (!PKG_SPEC.test(name)) { res.status(400).json({ error: 'Invalid package name' }); return; }
    const dir = resolveSessionCwd(s.working_dir);
    await pythonEnv.runExclusive(req.params.sessionId as string, async () => {
      const r = await pythonEnv.removePackage(dir, name);
      if (r.exitCode !== 0) throw new Error(r.stderr.trim() || 'uv remove failed');
    });
    res.json(await pythonEnv.listPackages(s.working_dir));
  } catch (err) {
    // uv refuses to remove a package that isn't a direct dependency.
    res.status(409).json({ error: (err as Error).message });
  }
});

// GET /api/python-env/:sessionId/manifest
router.get('/:sessionId/manifest', (req: Request, res: Response) => {
  try {
    const s = loadPySession(req, res); if (!s) return;
    res.json(pythonEnv.readManifest(resolveSessionCwd(s.working_dir)));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// PUT /api/python-env/:sessionId/manifest  { pyproject }
router.put('/:sessionId/manifest', async (req: Request, res: Response) => {
  try {
    const s = loadPySession(req, res); if (!s) return;
    const { pyproject } = req.body as { pyproject?: string };
    if (typeof pyproject !== 'string') { res.status(400).json({ error: 'pyproject (string) is required' }); return; }
    const dir = resolveSessionCwd(s.working_dir);
    const r = await pythonEnv.runExclusive(req.params.sessionId as string, () => pythonEnv.writeManifest(dir, pyproject));
    if (r.exitCode !== 0) { res.status(400).json({ error: r.stderr.trim() || 'uv sync failed' }); return; }
    res.json(await pythonEnv.listPackages(s.working_dir));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/python-env/:sessionId/sync  and  /lock
for (const [action, fn] of [['sync', 'syncProject'], ['lock', 'lockProject']] as const) {
  router.post(`/:sessionId/${action}`, async (req: Request, res: Response) => {
    try {
      const s = loadPySession(req, res); if (!s) return;
      const dir = resolveSessionCwd(s.working_dir);
      const r = await pythonEnv.runExclusive(req.params.sessionId as string, () => pythonEnv[fn](dir));
      if (r.exitCode !== 0) { res.status(400).json({ error: r.stderr.trim() || `uv ${action} failed` }); return; }
      res.json(await pythonEnv.listPackages(s.working_dir));
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
}

export default router;
