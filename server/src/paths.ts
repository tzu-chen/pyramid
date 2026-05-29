import path from 'path';

const APP = 'pyramid';
const root = process.env.SUITE_DATA_ROOT;

// Single source of truth for Pyramid's data directory. When SUITE_DATA_ROOT is
// set, every suite app shares "$SUITE_DATA_ROOT/<app>". When unset, fall back to
// the original in-repo location, copied verbatim from db.ts
// (path.join(__dirname, '..', 'data')). This module sits at server/src — the same
// directory depth as db.ts — so __dirname matches and the fallback is byte-for-byte
// identical to the legacy path.
export const DATA_DIR = root
  ? path.join(root, APP)
  : path.join(__dirname, '..', 'data');

export const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
export const LEAN_PROJECTS_DIR = path.join(DATA_DIR, 'lean-projects');

// A session's working_dir is stored relative to DATA_DIR (e.g. "sessions/<id>" or
// "lean-projects/<id>"). Legacy rows stored a "data/<...>" prefix relative to
// server/; the one-time migration strips that prefix so resolution can go through
// DATA_DIR uniformly whether data lives in-repo or under SUITE_DATA_ROOT.
export const resolveSessionCwd = (workingDir: string): string => path.join(DATA_DIR, workingDir);

console.log(`[pyramid] data dir: ${DATA_DIR}`);
