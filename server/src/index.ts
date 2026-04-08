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
import { leanLsp } from './services/lean-lsp.js';

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
  const match = pathname?.match(/^\/ws\/lean\/([a-f0-9-]+)$/);
  if (!match) {
    socket.destroy();
    return;
  }

  const sessionId = match[1];

  // Verify session exists and is a lean session
  const meta = db.prepare('SELECT project_path FROM lean_session_meta WHERE session_id = ?')
    .get(sessionId) as { project_path: string } | undefined;

  if (!meta) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    const projectPath = path.join(__dirname, '..', 'data', 'lean-projects', sessionId);
    leanLsp.handleWebSocket(ws, sessionId, projectPath);
  });
});

// Graceful shutdown
function shutdown() {
  leanLsp.forceStopAll();
  server.close(() => {
    process.exit(0);
  });
  // If server.close doesn't finish within 2 seconds, force exit
  const forceExit = setTimeout(() => process.exit(0), 2000);
  if (typeof forceExit === 'object' && 'unref' in forceExit) forceExit.unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
