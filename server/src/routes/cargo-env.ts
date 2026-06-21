import { Router, Request, Response } from 'express';
import db from '../db.js';
import { resolveSessionCwd } from '../paths.js';
import { cargoEnv } from '../services/cargo-env.js';

const router = Router();

// Accept a cargo dependency spec like `serde`, `serde@1.0`, `tokio@^1`,
// `regex@>=1, <2`. Reject anything that could be read as a cargo flag (leading
// dash) or that strays outside crate-name + version-req characters.
const CRATE_SPEC = /^[A-Za-z0-9][A-Za-z0-9._@^~<>=,*+ -]*$/;
const CRATE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

interface SessionRow { working_dir: string; session_type: string }

function loadRustSession(req: Request, res: Response): SessionRow | null {
  const row = db.prepare('SELECT working_dir, session_type FROM sessions WHERE id = ?')
    .get(req.params.sessionId as string) as SessionRow | undefined;
  if (!row) { res.status(404).json({ error: 'Session not found' }); return null; }
  if (row.session_type !== 'rust') { res.status(400).json({ error: 'Not a Rust session' }); return null; }
  if (!cargoEnv.cargoAvailable()) { res.status(409).json({ error: 'cargo is not available on the server' }); return null; }
  return row;
}

// GET /api/cargo-env/:sessionId/packages
router.get('/:sessionId/packages', async (req: Request, res: Response) => {
  try {
    const s = loadRustSession(req, res); if (!s) return;
    res.json(await cargoEnv.listPackages(s.working_dir));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/cargo-env/:sessionId/packages  { name, dev? }
router.post('/:sessionId/packages', async (req: Request, res: Response) => {
  try {
    const s = loadRustSession(req, res); if (!s) return;
    const { name, dev } = req.body as { name?: string; dev?: boolean };
    if (!name || typeof name !== 'string' || !CRATE_SPEC.test(name.trim())) {
      res.status(400).json({ error: 'Invalid crate spec' });
      return;
    }
    const dir = resolveSessionCwd(s.working_dir);
    await cargoEnv.runExclusive(req.params.sessionId as string, async () => {
      const r = await cargoEnv.addPackage(dir, name.trim(), !!dev);
      if (r.exitCode !== 0) throw new Error(r.stderr.trim() || 'cargo add failed');
    });
    res.json(await cargoEnv.listPackages(s.working_dir));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// DELETE /api/cargo-env/:sessionId/packages/:name
router.delete('/:sessionId/packages/:name', async (req: Request, res: Response) => {
  try {
    const s = loadRustSession(req, res); if (!s) return;
    const name = req.params.name as string;
    if (!CRATE_NAME.test(name)) { res.status(400).json({ error: 'Invalid crate name' }); return; }
    const dir = resolveSessionCwd(s.working_dir);
    await cargoEnv.runExclusive(req.params.sessionId as string, async () => {
      const r = await cargoEnv.removePackage(dir, name);
      if (r.exitCode !== 0) throw new Error(r.stderr.trim() || 'cargo remove failed');
    });
    res.json(await cargoEnv.listPackages(s.working_dir));
  } catch (err) {
    res.status(409).json({ error: (err as Error).message });
  }
});

// GET /api/cargo-env/:sessionId/manifest
router.get('/:sessionId/manifest', (req: Request, res: Response) => {
  try {
    const s = loadRustSession(req, res); if (!s) return;
    res.json(cargoEnv.readManifest(resolveSessionCwd(s.working_dir)));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// PUT /api/cargo-env/:sessionId/manifest  { manifest }
router.put('/:sessionId/manifest', async (req: Request, res: Response) => {
  try {
    const s = loadRustSession(req, res); if (!s) return;
    const { manifest } = req.body as { manifest?: string };
    if (typeof manifest !== 'string') { res.status(400).json({ error: 'manifest (string) is required' }); return; }
    const dir = resolveSessionCwd(s.working_dir);
    const r = await cargoEnv.runExclusive(req.params.sessionId as string, () => cargoEnv.writeManifest(dir, manifest));
    if (r.exitCode !== 0) { res.status(400).json({ error: r.stderr.trim() || 'cargo metadata failed' }); return; }
    res.json(await cargoEnv.listPackages(s.working_dir));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
