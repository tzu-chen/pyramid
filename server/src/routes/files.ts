import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import db from '../db.js';
import { validateFilePath, cleanEmptyParentDirs } from '../utils/path-security.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

function getCstTimestamp(): string {
  const now = new Date();
  const cst = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  return cst.toISOString().replace('Z', '-06:00');
}

function getSessionRoot(workingDir: string): string {
  return path.join(__dirname, '..', '..', workingDir);
}

// GET /api/sessions/:id/files
router.get('/:id/files', (req: Request, res: Response) => {
  try {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const files = db.prepare('SELECT * FROM session_files WHERE session_id = ? ORDER BY is_primary DESC, created_at ASC').all(req.params.id);
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/sessions/:id/files/:fileId
router.get('/:id/files/:fileId', (req: Request, res: Response) => {
  try {
    const file = db.prepare('SELECT * FROM session_files WHERE id = ? AND session_id = ?').get(req.params.fileId, req.params.id);
    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    res.json(file);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/sessions/:id/files/:fileId/content
router.get('/:id/files/:fileId/content', (req: Request, res: Response) => {
  try {
    const file = db.prepare('SELECT * FROM session_files WHERE id = ? AND session_id = ?').get(req.params.fileId, req.params.id) as Record<string, unknown> | undefined;
    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as Record<string, unknown>;
    const filePath = path.join(getSessionRoot(session.working_dir as string), file.filename as string);

    if (!fs.existsSync(filePath)) {
      res.type('text/plain').send('');
      return;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    res.type('text/plain').send(content);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/sessions/:id/files
router.post('/:id/files', (req: Request, res: Response) => {
  try {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const { filename, language = '', content = '', is_primary = false, file_type = 'source' } = req.body;
    if (!filename) {
      res.status(400).json({ error: 'Filename is required' });
      return;
    }

    const validation = validateFilePath(filename);
    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }
    const normalizedFilename = validation.normalized!;

    // Check for duplicate
    const existing = db.prepare('SELECT id FROM session_files WHERE session_id = ? AND filename = ?').get(req.params.id, normalizedFilename);
    if (existing) {
      res.status(409).json({ error: 'A file with this name already exists' });
      return;
    }

    const id = uuidv4();
    const now = getCstTimestamp();

    // If this file is primary, unset any existing primary
    if (is_primary) {
      db.prepare('UPDATE session_files SET is_primary = 0 WHERE session_id = ?').run(req.params.id);
    }

    db.prepare(`
      INSERT INTO session_files (id, session_id, filename, file_type, language, is_primary, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.params.id, normalizedFilename, file_type, language, is_primary ? 1 : 0, now, now);

    // Create parent directories and write content to disk
    const sessionRoot = getSessionRoot(session.working_dir as string);
    const filePath = path.join(sessionRoot, normalizedFilename);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);

    const file = db.prepare('SELECT * FROM session_files WHERE id = ?').get(id);
    res.status(201).json(file);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// PATCH /api/sessions/:id/files/:fileId (rename/move)
router.patch('/:id/files/:fileId', (req: Request, res: Response) => {
  try {
    const file = db.prepare('SELECT * FROM session_files WHERE id = ? AND session_id = ?').get(req.params.fileId, req.params.id) as Record<string, unknown> | undefined;
    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const { filename } = req.body;
    if (!filename) {
      res.status(400).json({ error: 'New filename is required' });
      return;
    }

    const validation = validateFilePath(filename);
    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }
    const newFilename = validation.normalized!;

    // Check for duplicate
    const existing = db.prepare('SELECT id FROM session_files WHERE session_id = ? AND filename = ? AND id != ?').get(req.params.id, newFilename, req.params.fileId);
    if (existing) {
      res.status(409).json({ error: 'A file with this name already exists' });
      return;
    }

    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as Record<string, unknown>;
    const sessionRoot = getSessionRoot(session.working_dir as string);
    const oldPath = path.join(sessionRoot, file.filename as string);
    const newPath = path.join(sessionRoot, newFilename);

    // Create parent dirs and move file
    fs.mkdirSync(path.dirname(newPath), { recursive: true });
    if (fs.existsSync(oldPath)) {
      fs.renameSync(oldPath, newPath);
    }

    // Clean up empty parent dirs from old location
    cleanEmptyParentDirs(oldPath, sessionRoot);

    const now = getCstTimestamp();
    db.prepare('UPDATE session_files SET filename = ?, updated_at = ? WHERE id = ?').run(newFilename, now, req.params.fileId);

    const updated = db.prepare('SELECT * FROM session_files WHERE id = ?').get(req.params.fileId);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// PUT /api/sessions/:id/files/:fileId/content
router.put('/:id/files/:fileId/content', (req: Request, res: Response) => {
  try {
    const file = db.prepare('SELECT * FROM session_files WHERE id = ? AND session_id = ?').get(req.params.fileId, req.params.id) as Record<string, unknown> | undefined;
    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as Record<string, unknown>;
    const { content } = req.body;
    if (content === undefined) {
      res.status(400).json({ error: 'Content is required' });
      return;
    }

    const filePath = path.join(getSessionRoot(session.working_dir as string), file.filename as string);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);

    const now = getCstTimestamp();
    db.prepare('UPDATE session_files SET updated_at = ? WHERE id = ?').run(now, req.params.fileId);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// DELETE /api/sessions/:id/files/:fileId
router.delete('/:id/files/:fileId', (req: Request, res: Response) => {
  try {
    const file = db.prepare('SELECT * FROM session_files WHERE id = ? AND session_id = ?').get(req.params.fileId, req.params.id) as Record<string, unknown> | undefined;
    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as Record<string, unknown>;
    const sessionRoot = getSessionRoot(session.working_dir as string);
    const filePath = path.join(sessionRoot, file.filename as string);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Clean up empty parent dirs
    cleanEmptyParentDirs(filePath, sessionRoot);

    db.prepare('DELETE FROM session_files WHERE id = ?').run(req.params.fileId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/sessions/:id/folders (create empty folder)
router.post('/:id/folders', (req: Request, res: Response) => {
  try {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const { path: folderPath } = req.body;
    if (!folderPath) {
      res.status(400).json({ error: 'Folder path is required' });
      return;
    }

    const validation = validateFilePath(folderPath);
    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const sessionRoot = getSessionRoot(session.working_dir as string);
    const absPath = path.join(sessionRoot, validation.normalized!);
    fs.mkdirSync(absPath, { recursive: true });

    res.status(201).json({ success: true, path: validation.normalized });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// PATCH /api/sessions/:id/folders (rename folder)
router.patch('/:id/folders', (req: Request, res: Response) => {
  try {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const { oldPath, newPath } = req.body;
    if (!oldPath || !newPath) {
      res.status(400).json({ error: 'oldPath and newPath are required' });
      return;
    }

    const oldValidation = validateFilePath(oldPath);
    const newValidation = validateFilePath(newPath);
    if (!oldValidation.valid) {
      res.status(400).json({ error: oldValidation.error });
      return;
    }
    if (!newValidation.valid) {
      res.status(400).json({ error: newValidation.error });
      return;
    }

    const normalizedOld = oldValidation.normalized!;
    const normalizedNew = newValidation.normalized!;
    const sessionRoot = getSessionRoot(session.working_dir as string);

    // Rename directory on disk
    const absOld = path.join(sessionRoot, normalizedOld);
    const absNew = path.join(sessionRoot, normalizedNew);
    if (fs.existsSync(absOld)) {
      fs.mkdirSync(path.dirname(absNew), { recursive: true });
      fs.renameSync(absOld, absNew);
    }

    // Update all file paths in DB
    const files = db.prepare("SELECT id, filename FROM session_files WHERE session_id = ? AND (filename LIKE ? OR filename = ?)").all(
      req.params.id, normalizedOld + '/%', normalizedOld
    ) as Array<{ id: string; filename: string }>;

    const now = getCstTimestamp();
    const updateStmt = db.prepare('UPDATE session_files SET filename = ?, updated_at = ? WHERE id = ?');
    const transaction = db.transaction(() => {
      for (const file of files) {
        const newFilename = normalizedNew + file.filename.substring(normalizedOld.length);
        updateStmt.run(newFilename, now, file.id);
      }
    });
    transaction();

    // Clean up empty parent dirs from old location
    cleanEmptyParentDirs(absOld, sessionRoot);

    res.json({ success: true, renamed: files.length });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// DELETE /api/sessions/:id/folders
router.delete('/:id/folders', (req: Request, res: Response) => {
  try {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const folderPath = req.query.path as string;
    if (!folderPath) {
      res.status(400).json({ error: 'Folder path query parameter is required' });
      return;
    }

    const validation = validateFilePath(folderPath);
    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const normalized = validation.normalized!;
    const sessionRoot = getSessionRoot(session.working_dir as string);

    // Delete all files in folder from DB
    const files = db.prepare("SELECT id FROM session_files WHERE session_id = ? AND filename LIKE ?").all(
      req.params.id, normalized + '/%'
    ) as Array<{ id: string }>;

    db.prepare("DELETE FROM session_files WHERE session_id = ? AND filename LIKE ?").run(
      req.params.id, normalized + '/%'
    );

    // Remove directory from disk
    const absPath = path.join(sessionRoot, normalized);
    if (fs.existsSync(absPath)) {
      fs.rmSync(absPath, { recursive: true });
    }

    // Clean up empty parent dirs
    cleanEmptyParentDirs(absPath, sessionRoot);

    res.json({ success: true, deleted: files.length });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/sessions/:id/upload (file upload)
router.post('/:id/upload', upload.single('file'), (req: Request, res: Response) => {
  try {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const directory = (req.body.directory as string) || '';
    const rawFilename = directory ? `${directory}/${req.file.originalname}` : req.file.originalname;

    const validation = validateFilePath(rawFilename);
    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }
    const normalizedFilename = validation.normalized!;

    // Check for duplicate
    const existing = db.prepare('SELECT id FROM session_files WHERE session_id = ? AND filename = ?').get(req.params.id, normalizedFilename);
    if (existing) {
      res.status(409).json({ error: 'A file with this name already exists' });
      return;
    }

    const sessionRoot = getSessionRoot(session.working_dir as string);
    const filePath = path.join(sessionRoot, normalizedFilename);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, req.file.buffer);

    // Infer language from extension
    const ext = path.extname(normalizedFilename).slice(1).toLowerCase();
    const langMap: Record<string, string> = { py: 'python', jl: 'julia', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', h: 'cpp', hpp: 'cpp', lean: 'lean', js: 'javascript', ts: 'typescript' };
    const language = langMap[ext] || '';

    const id = uuidv4();
    const now = getCstTimestamp();

    db.prepare(`
      INSERT INTO session_files (id, session_id, filename, file_type, language, is_primary, created_at, updated_at)
      VALUES (?, ?, ?, 'source', ?, 0, ?, ?)
    `).run(id, req.params.id, normalizedFilename, language, now, now);

    const file = db.prepare('SELECT * FROM session_files WHERE id = ?').get(id);
    res.status(201).json(file);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/sessions/:id/tree (directory listing)
router.get('/:id/tree', (req: Request, res: Response) => {
  try {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const sessionRoot = getSessionRoot(session.working_dir as string);
    const entries: string[] = [];

    function walk(dir: string, prefix: string) {
      if (!fs.existsSync(dir)) return;
      const items = fs.readdirSync(dir, { withFileTypes: true });
      // Sort: directories first, then alphabetical
      items.sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      for (const item of items) {
        const rel = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.isDirectory()) {
          entries.push(rel + '/');
          walk(path.join(dir, item.name), rel);
        } else {
          entries.push(rel);
        }
      }
    }

    walk(sessionRoot, '');
    res.json({ files: entries });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
