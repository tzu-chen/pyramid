import express from 'express';
import cors from 'cors';
import path from 'path';
import { WebSocketServer } from 'ws';
import { parse as parseUrl } from 'url';
import './db.js';
import db from './db.js';
import sessionsRouter from './routes/sessions.js';
import filesRouter from './routes/files.js';
import executionRouter from './routes/execution.js';
import statsRouter from './routes/stats.js';
import settingsRouter from './routes/settings.js';
import leanRouter from './routes/lean.js';
import claudeRouter from './routes/claude.js';
import scribeProxyRouter from './routes/scribe-proxy.js';
import notebooksRouter from './routes/notebooks.js';
import { leanLsp } from './services/lean-lsp.js';
import { cppLsp } from './services/cpp-lsp.js';
import { cppProject } from './services/cpp-project.js';
import { notebookKernel } from './services/notebook-kernel.js';
import { terminal } from './services/terminal.js';

const app = express();
const PORT = parseInt(process.env.PORT || '3007', 10);

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// API routes
app.use('/api/sessions', sessionsRouter);
app.use('/api/sessions', filesRouter);
app.use('/api/sessions', executionRouter);
app.use('/api/stats', statsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/lean', leanRouter);
app.use('/api/sessions', claudeRouter);
app.use('/api/scribe', scribeProxyRouter);
app.use('/api/notebooks', notebooksRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve static frontend in production
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

const server = app.listen(PORT, () => {
  console.log(`Pyramid server running on port ${PORT}`);
});

// WebSocket server for Lean LSP
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const { pathname } = parseUrl(request.url || '');

  // Match /ws/lean/:sessionId
  const leanMatch = pathname?.match(/^\/ws\/lean\/([a-f0-9-]+)$/);
  if (leanMatch) {
    const sessionId = leanMatch[1];
    const meta = db.prepare('SELECT project_path FROM lean_session_meta WHERE session_id = ?')
      .get(sessionId) as { project_path: string } | undefined;
    if (!meta) { socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, (ws) => {
      const projectPath = path.join(__dirname, '..', 'data', 'lean-projects', sessionId);
      leanLsp.handleWebSocket(ws, sessionId, projectPath);
    });
    return;
  }

  // Match /ws/cpp/:sessionId
  const cppMatch = pathname?.match(/^\/ws\/cpp\/([a-f0-9-]+)$/);
  if (cppMatch) {
    const sessionId = cppMatch[1];
    const session = db.prepare('SELECT session_type, language, working_dir FROM sessions WHERE id = ?')
      .get(sessionId) as { session_type: string; language: string; working_dir: string } | undefined;
    if (!session || session.session_type !== 'freeform' || session.language !== 'cpp') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      const cwd = path.join(__dirname, '..', session.working_dir);
      // Bootstrap .clangd for sessions created before this feature landed
      cppProject.ensureClangdConfig(cwd);
      cppLsp.handleWebSocket(ws, sessionId, cwd);
    });
    return;
  }

  // Match /ws/notebook/:sessionId
  const nbMatch = pathname?.match(/^\/ws\/notebook\/([a-f0-9-]+)$/);
  if (nbMatch) {
    const sessionId = nbMatch[1];
    const session = db.prepare('SELECT session_type, working_dir FROM sessions WHERE id = ?')
      .get(sessionId) as { session_type: string; working_dir: string } | undefined;
    if (!session || session.session_type !== 'notebook') { socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, (ws) => {
      const cwd = path.join(__dirname, '..', session.working_dir);
      notebookKernel.handleWebSocket(ws, sessionId, cwd);
    });
    return;
  }

  // Match /ws/terminal/:sessionId/:tabId
  const termMatch = pathname?.match(/^\/ws\/terminal\/([a-f0-9-]+)\/([a-zA-Z0-9_-]{1,64})$/);
  if (termMatch) {
    const sessionId = termMatch[1];
    const tabId = termMatch[2];
    const session = db.prepare('SELECT session_type, working_dir FROM sessions WHERE id = ?')
      .get(sessionId) as { session_type: string; working_dir: string } | undefined;
    if (!session || session.session_type !== 'freeform') { socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, (ws) => {
      const cwd = path.join(__dirname, '..', session.working_dir);
      terminal.handleWebSocket(ws, sessionId, tabId, cwd);
    });
    return;
  }

  socket.destroy();
});

// Graceful shutdown
function shutdown() {
  leanLsp.forceStopAll();
  cppLsp.forceStopAll();
  notebookKernel.forceStopAll();
  terminal.forceStopAll();
  server.close(() => {
    process.exit(0);
  });
  // If server.close doesn't finish within 2 seconds, force exit
  const forceExit = setTimeout(() => process.exit(0), 2000);
  if (typeof forceExit === 'object' && 'unref' in forceExit) forceExit.unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
