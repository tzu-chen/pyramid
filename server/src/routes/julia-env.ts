import { Router, Request, Response } from 'express';
import db from '../db.js';
import { resolveSessionCwd } from '../paths.js';
import { juliaEnv } from '../services/julia-env.js';

const router = Router();

// Julia package names are identifiers (letters/digits/underscore, starting with a
// letter). Reject anything that could be read as a CLI flag or carries a version
// spec — version constraints are managed through the manifest editor / [compat].
const PKG_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

interface SessionRow { working_dir: string; session_type: string }

function loadJuliaSession(req: Request, res: Response): SessionRow | null {
  const row = db.prepare('SELECT working_dir, session_type FROM sessions WHERE id = ?')
    .get(req.params.sessionId as string) as SessionRow | undefined;
  if (!row) { res.status(404).json({ error: 'Session not found' }); return null; }
  if (row.session_type !== 'julia') { res.status(400).json({ error: 'Not a Julia session' }); return null; }
  if (!juliaEnv.juliaAvailable()) { res.status(409).json({ error: 'julia is not available on the server' }); return null; }
  return row;
}

// GET /api/julia-env/:sessionId/packages
router.get('/:sessionId/packages', async (req: Request, res: Response) => {
  try {
    const s = loadJuliaSession(req, res); if (!s) return;
    res.json(await juliaEnv.listPackages(s.working_dir));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/julia-env/:sessionId/packages  { name }
router.post('/:sessionId/packages', async (req: Request, res: Response) => {
  try {
    const s = loadJuliaSession(req, res); if (!s) return;
    const { name } = req.body as { name?: string };
    if (!name || typeof name !== 'string' || !PKG_NAME.test(name.trim())) {
      res.status(400).json({ error: 'Invalid package name (expected a bare Julia identifier)' });
      return;
    }
    const dir = resolveSessionCwd(s.working_dir);
    await juliaEnv.runExclusive(req.params.sessionId as string, async () => {
      const r = await juliaEnv.addPackage(dir, name.trim());
      if (r.exitCode !== 0) throw new Error(r.stderr.trim() || 'Pkg.add failed');
    });
    res.json(await juliaEnv.listPackages(s.working_dir));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// DELETE /api/julia-env/:sessionId/packages/:name
router.delete('/:sessionId/packages/:name', async (req: Request, res: Response) => {
  try {
    const s = loadJuliaSession(req, res); if (!s) return;
    const name = req.params.name as string;
    if (!PKG_NAME.test(name)) { res.status(400).json({ error: 'Invalid package name' }); return; }
    const dir = resolveSessionCwd(s.working_dir);
    await juliaEnv.runExclusive(req.params.sessionId as string, async () => {
      const r = await juliaEnv.removePackage(dir, name);
      if (r.exitCode !== 0) throw new Error(r.stderr.trim() || 'Pkg.rm failed');
    });
    res.json(await juliaEnv.listPackages(s.working_dir));
  } catch (err) {
    res.status(409).json({ error: (err as Error).message });
  }
});

// GET /api/julia-env/:sessionId/manifest  (returns Project.toml — the editable
// dependency file; Cargo.toml analog)
router.get('/:sessionId/manifest', (req: Request, res: Response) => {
  try {
    const s = loadJuliaSession(req, res); if (!s) return;
    res.json(juliaEnv.readManifest(resolveSessionCwd(s.working_dir)));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// PUT /api/julia-env/:sessionId/manifest  { manifest }
router.put('/:sessionId/manifest', async (req: Request, res: Response) => {
  try {
    const s = loadJuliaSession(req, res); if (!s) return;
    const { manifest } = req.body as { manifest?: string };
    if (typeof manifest !== 'string') { res.status(400).json({ error: 'manifest (string) is required' }); return; }
    const dir = resolveSessionCwd(s.working_dir);
    const r = await juliaEnv.runExclusive(req.params.sessionId as string, () => juliaEnv.writeManifest(dir, manifest));
    if (r.exitCode !== 0) { res.status(400).json({ error: r.stderr.trim() || 'Pkg.resolve failed' }); return; }
    res.json(await juliaEnv.listPackages(s.working_dir));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
