import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import db from '../db.js';
import { executeFile } from '../services/execution.js';
import fs from 'fs';
import {
  isCmakeProject,
  ensureBuilt,
  cmakeConfigure,
  cmakeBuild,
  runBinary,
  pickBinary,
  validateFlavor,
  flavorDirName,
  cleanFlavor,
  cleanAll,
  listBinaries,
  listArtifactTree,
  resolveArtifactPath,
  statArtifact,
  readArtifactText,
  type BuildFlavor,
  type BuildResult,
  type CompilerDiagnostic,
} from '../services/cpp-build.js';

const router = Router();

function getCstTimestamp(): string {
  const now = new Date();
  const cst = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  return cst.toISOString().replace('Z', '-06:00');
}

function sessionAbsDir(sessionWorkingDir: string): string {
  return path.join(__dirname, '..', '..', sessionWorkingDir);
}

function parseFlavor(input: unknown): BuildFlavor {
  const fallback: BuildFlavor = { buildType: 'Debug' };
  if (!input || typeof input !== 'object') return fallback;
  const obj = input as Record<string, unknown>;
  const buildType = (obj.buildType as BuildFlavor['buildType']) ?? fallback.buildType;
  const sanitizers = Array.isArray(obj.sanitizers) ? (obj.sanitizers as BuildFlavor['sanitizers']) : undefined;
  return { buildType, sanitizers };
}

function persistBuild(
  sessionId: string,
  flavor: BuildFlavor,
  result: BuildResult,
): string {
  const buildId = uuidv4();
  const now = getCstTimestamp();
  const insertBuild = db.prepare(`
    INSERT INTO builds (id, session_id, flavor, success, duration_ms, diagnostic_count, log, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertDiag = db.prepare(`
    INSERT INTO build_diagnostics (id, build_id, file, line, col, severity, message)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    insertBuild.run(
      buildId,
      sessionId,
      flavorDirName(flavor),
      result.success ? 1 : 0,
      result.durationMs,
      result.diagnostics.length,
      result.log,
      now,
    );
    for (const d of result.diagnostics) {
      insertDiag.run(uuidv4(), buildId, d.file, d.line, d.column, d.severity, d.message);
    }
  });
  tx();
  return buildId;
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

    const { file_id, timeout_ms, stdin, flavor: flavorIn, target, args, reconfigure } = req.body;

    let file: Record<string, unknown> | undefined;
    if (file_id) {
      file = db.prepare('SELECT * FROM session_files WHERE id = ? AND session_id = ?').get(file_id, req.params.id) as Record<string, unknown> | undefined;
    } else {
      file = db.prepare('SELECT * FROM session_files WHERE session_id = ? AND is_primary = 1').get(req.params.id) as Record<string, unknown> | undefined;
    }

    const absWorkingDir = sessionAbsDir(session.working_dir as string);
    const language = (file?.language as string) || (session.language as string);
    const isCpp = language === 'cpp';
    const useCmake = isCpp && isCmakeProject(absWorkingDir);

    const defaultTimeout = useCmake ? 120000 : 30000;
    const timeout = timeout_ms || defaultTimeout;

    if (useCmake) {
      const flavor = parseFlavor(flavorIn);
      const v = validateFlavor(flavor);
      if (!v.valid) {
        res.status(400).json({ error: v.error });
        return;
      }

      // Need *some* file_id for the run row (NOT NULL). Fall back to the session
      // primary file if none was passed (CMake runs aren't tied to a single file).
      const runFile = file ?? (db.prepare('SELECT * FROM session_files WHERE session_id = ? AND is_primary = 1').get(req.params.id) as Record<string, unknown> | undefined);
      if (!runFile) {
        res.status(400).json({ error: 'Session has no files; create one before running' });
        return;
      }

      const build = await ensureBuilt(absWorkingDir, flavor, { ...flavor, target, reconfigure: !!reconfigure });
      const buildId = persistBuild(req.params.id as string, flavor, build);

      if (!build.success) {
        res.json({
          kind: 'build_failed',
          build_id: buildId,
          flavor: flavorDirName(flavor),
          success: false,
          diagnostics: build.diagnostics,
          log: build.log,
          duration_ms: build.durationMs,
        });
        return;
      }

      const binary = pickBinary(build.binaryPaths, target);
      if (!binary) {
        res.json({
          kind: 'no_binary',
          build_id: buildId,
          flavor: flavorDirName(flavor),
          success: false,
          diagnostics: build.diagnostics,
          log: build.log + '\n[run] no executable produced — specify a target or add an add_executable() call',
          duration_ms: build.durationMs,
        });
        return;
      }

      const run = await runBinary(binary, absWorkingDir, {
        args: Array.isArray(args) ? args : undefined,
        stdin,
        timeoutMs: timeout,
      });

      const runId = uuidv4();
      const now = getCstTimestamp();
      db.prepare(`
        INSERT INTO execution_runs (id, session_id, file_id, command, exit_code, stdout, stderr, duration_ms, created_at, build_id, binary_path, flavor)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        runId,
        req.params.id,
        runFile.id as string,
        run.command,
        run.exitCode,
        run.stdout,
        run.stderr,
        run.durationMs,
        now,
        buildId,
        binary,
        flavorDirName(flavor),
      );

      const persistedRun = db.prepare('SELECT * FROM execution_runs WHERE id = ?').get(runId);
      res.json({
        kind: 'ran',
        build_id: buildId,
        flavor: flavorDirName(flavor),
        success: true,
        diagnostics: build.diagnostics,
        build_log: build.log,
        build_duration_ms: build.durationMs,
        binary_path: binary,
        run: persistedRun,
      });
      return;
    }

    // Single-file path
    if (!file) {
      res.status(404).json({ error: 'No file to execute' });
      return;
    }

    const result = await executeFile(absWorkingDir, file.filename as string, language, {
      timeout_ms: timeout,
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

// ----- CMake-specific endpoints -----

function loadSessionDir(req: Request, res: Response): string | null {
  const session = db.prepare('SELECT working_dir, language FROM sessions WHERE id = ?').get(req.params.id) as { working_dir: string; language: string } | undefined;
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return null;
  }
  if (session.language !== 'cpp') {
    res.status(400).json({ error: 'Session is not a C++ session' });
    return null;
  }
  return sessionAbsDir(session.working_dir);
}

// GET /api/sessions/:id/cmake/status
router.get('/:id/cmake/status', (req: Request, res: Response) => {
  try {
    const dir = loadSessionDir(req, res);
    if (!dir) return;
    res.json({
      is_cmake_project: isCmakeProject(dir),
      project_path: dir,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/sessions/:id/cmake/configure
router.post('/:id/cmake/configure', async (req: Request, res: Response) => {
  try {
    const dir = loadSessionDir(req, res);
    if (!dir) return;
    if (!isCmakeProject(dir)) {
      res.status(400).json({ error: 'No CMakeLists.txt in session root' });
      return;
    }
    const flavor = parseFlavor(req.body?.flavor);
    const v = validateFlavor(flavor);
    if (!v.valid) {
      res.status(400).json({ error: v.error });
      return;
    }
    const result = await cmakeConfigure(dir, flavor, { reconfigure: !!req.body?.reconfigure });
    res.json({ ...result, flavor: flavorDirName(flavor) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/sessions/:id/cmake/build
router.post('/:id/cmake/build', async (req: Request, res: Response) => {
  try {
    const dir = loadSessionDir(req, res);
    if (!dir) return;
    if (!isCmakeProject(dir)) {
      res.status(400).json({ error: 'No CMakeLists.txt in session root' });
      return;
    }
    const flavor = parseFlavor(req.body?.flavor);
    const v = validateFlavor(flavor);
    if (!v.valid) {
      res.status(400).json({ error: v.error });
      return;
    }
    const result = await ensureBuilt(dir, flavor, {
      ...flavor,
      target: req.body?.target,
      jobs: req.body?.jobs,
      reconfigure: !!req.body?.reconfigure,
    });
    const buildId = persistBuild(req.params.id as string, flavor, result);
    res.json({
      build_id: buildId,
      flavor: flavorDirName(flavor),
      success: result.success,
      duration_ms: result.durationMs,
      diagnostics: result.diagnostics,
      log: result.log,
      binary_paths: result.binaryPaths,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/sessions/:id/cmake/builds
router.get('/:id/cmake/builds', (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const builds = db.prepare(`
      SELECT id, session_id, flavor, success, duration_ms, diagnostic_count, created_at
      FROM builds WHERE session_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(req.params.id, limit);
    res.json(builds);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/sessions/:id/cmake/builds/:buildId
router.get('/:id/cmake/builds/:buildId', (req: Request, res: Response) => {
  try {
    const build = db.prepare('SELECT * FROM builds WHERE id = ? AND session_id = ?').get(req.params.buildId, req.params.id);
    if (!build) {
      res.status(404).json({ error: 'Build not found' });
      return;
    }
    const diagnostics = db.prepare('SELECT file, line, col AS column, severity, message FROM build_diagnostics WHERE build_id = ?').all(req.params.buildId) as CompilerDiagnostic[];
    res.json({ ...build, diagnostics });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/sessions/:id/cmake/binaries?flavor=Debug
router.get('/:id/cmake/binaries', (req: Request, res: Response) => {
  try {
    const dir = loadSessionDir(req, res);
    if (!dir) return;
    const flavor = parseFlavor({
      buildType: req.query.buildType ?? 'Debug',
      sanitizers: req.query.sanitizers ? String(req.query.sanitizers).split(',') : undefined,
    });
    const v = validateFlavor(flavor);
    if (!v.valid) {
      res.status(400).json({ error: v.error });
      return;
    }
    const binaries = listBinaries(dir, flavor).map((p) => ({ path: p, name: path.basename(p) }));
    res.json({ flavor: flavorDirName(flavor), binaries });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/sessions/:id/cmake/artifacts
router.get('/:id/cmake/artifacts', (req: Request, res: Response) => {
  try {
    const dir = loadSessionDir(req, res);
    if (!dir) return;
    res.json({ tree: listArtifactTree(dir) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/sessions/:id/cmake/artifacts/content?path=<rel>
router.get('/:id/cmake/artifacts/content', (req: Request, res: Response) => {
  try {
    const dir = loadSessionDir(req, res);
    if (!dir) return;
    const rel = String(req.query.path ?? '');
    const result = readArtifactText(dir, rel);
    if (!result) {
      res.status(404).json({ error: 'Artifact not found or not readable' });
      return;
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/sessions/:id/cmake/artifacts/download?path=<rel>
router.get('/:id/cmake/artifacts/download', (req: Request, res: Response) => {
  try {
    const dir = loadSessionDir(req, res);
    if (!dir) return;
    const rel = String(req.query.path ?? '');
    const info = statArtifact(dir, rel);
    if (!info || info.isDir) {
      res.status(404).json({ error: 'Artifact not found' });
      return;
    }
    const abs = resolveArtifactPath(dir, rel);
    if (!abs) {
      res.status(400).json({ error: 'Invalid artifact path' });
      return;
    }
    res.setHeader('Content-Disposition', `attachment; filename="${info.name.replace(/"/g, '')}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(info.size));
    fs.createReadStream(abs).pipe(res);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/sessions/:id/cmake/clean
router.post('/:id/cmake/clean', (req: Request, res: Response) => {
  try {
    const dir = loadSessionDir(req, res);
    if (!dir) return;
    const all = !!req.body?.all;
    if (all) {
      const removed = cleanAll(dir);
      res.json({ removed, scope: 'all' });
      return;
    }
    const flavor = parseFlavor(req.body?.flavor);
    const v = validateFlavor(flavor);
    if (!v.valid) {
      res.status(400).json({ error: v.error });
      return;
    }
    const removed = cleanFlavor(dir, flavor);
    res.json({ removed, scope: flavorDirName(flavor) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
