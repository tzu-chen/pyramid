import express from 'express';
import cors from 'cors';
import path from 'path';
import './db.js';
import sessionsRouter from './routes/sessions.js';
import filesRouter from './routes/files.js';
import executionRouter from './routes/execution.js';
import cpRouter from './routes/cp.js';
import reposRouter from './routes/repos.js';
import statsRouter from './routes/stats.js';
import settingsRouter from './routes/settings.js';

const app = express();
const PORT = parseInt(process.env.PORT || '3007', 10);

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// API routes
app.use('/api/sessions', sessionsRouter);
app.use('/api/sessions', filesRouter);
app.use('/api/sessions', executionRouter);
app.use('/api/cp', cpRouter);
app.use('/api/repos', reposRouter);
app.use('/api/stats', statsRouter);
app.use('/api/settings', settingsRouter);

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

app.listen(PORT, () => {
  console.log(`Pyramid server running on port ${PORT}`);
});
