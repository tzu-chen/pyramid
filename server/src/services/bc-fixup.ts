import fs from 'fs';
import os from 'os';
import path from 'path';

// Dune compiles OCaml sources with the magic prefix /workspace_root embedded
// as the search-dir path in bytecode debug info. This is for reproducible
// builds (the BUILD_PATH_PREFIX_MAP feature) but it makes earlybird useless
// because it can't find any source file via paths under /workspace_root.
//
// earlybird has a `source_dirs` launch arg in its schema but never wires it
// into Symbols.create — so we can't fix this through DAP. The workable
// alternatives are bytecode rewriting or bind-mount sandboxing. We chose
// rewriting: create a per-session symlink at /tmp/p-<8-hex> (exactly the
// same byte length as /workspace_root) pointing to the session's working
// directory, then byte-replace the placeholder in every .bc file. Same
// length → no marshal/TOC rewriting needed.
//
// The DAP bridge translates the symlink path back to the real session path
// for any DAP message flowing toward the client, and vice versa, so the
// editor still sees its own canonical paths.

const PLACEHOLDER = '/workspace_root';

export function symlinkPath(sessionId: string): string {
  // First 8 hex chars of the session UUID. Collision probability between
  // two pyramid sessions on the same machine is ~1 in 4 billion; acceptable
  // for a personal tool.
  return path.join(os.tmpdir(), `p-${sessionId.slice(0, 8)}`);
}

// Sanity: make sure the symlink path is the same byte length as the
// placeholder so we can do in-place replacement.
function assertSameLength(link: string): void {
  if (Buffer.byteLength(link, 'utf8') !== Buffer.byteLength(PLACEHOLDER, 'utf8')) {
    throw new Error(
      `bc-fixup: symlink path '${link}' must be ${PLACEHOLDER.length} bytes ` +
      `to match '${PLACEHOLDER}'; got ${Buffer.byteLength(link, 'utf8')}`
    );
  }
}

export function ensureSymlink(sessionId: string, sessionAbsDir: string): string {
  const link = symlinkPath(sessionId);
  assertSameLength(link);
  try {
    const current = fs.readlinkSync(link);
    if (current === sessionAbsDir) return link;
    fs.unlinkSync(link);
  } catch {
    /* not present or not a symlink — recreate below */
  }
  // Best-effort: if a non-symlink exists at this path, try to remove and recreate.
  if (fs.existsSync(link)) {
    try { fs.unlinkSync(link); } catch { /* */ }
  }
  fs.symlinkSync(sessionAbsDir, link);
  return link;
}

// Walks the session's _build/ tree (passed as `buildRoot`) and patches every
// .bc file in place. Idempotent: rerunning after another build re-applies the
// patch to any freshly-rebuilt files.
export function rewriteBytecodeFiles(buildRoot: string, sessionId: string, sessionAbsDir: string): number {
  const link = ensureSymlink(sessionId, sessionAbsDir);
  assertSameLength(link);
  let patched = 0;
  walkBcFiles(buildRoot).forEach((bc) => {
    if (rewriteOne(bc, link)) patched++;
  });
  return patched;
}

function walkBcFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  const walk = (d: string) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); }
    catch { return; }
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue;
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile() && ent.name.endsWith('.bc')) out.push(full);
    }
  };
  walk(dir);
  return out;
}

function rewriteOne(bcPath: string, replacement: string): boolean {
  const buf = fs.readFileSync(bcPath);
  const placeholderBytes = Buffer.from(PLACEHOLDER, 'utf8');
  const replacementBytes = Buffer.from(replacement, 'utf8');
  let modified = false;
  let i = 0;
  while ((i = buf.indexOf(placeholderBytes, i)) !== -1) {
    replacementBytes.copy(buf, i);
    modified = true;
    i += replacementBytes.length;
  }
  if (!modified) return false;
  // Dune writes .bc files read-only (-r-xr-xr-x). Make writable for our
  // patch, restore the original mode after.
  let origMode = 0o555;
  try { origMode = fs.statSync(bcPath).mode; } catch { /* */ }
  try { fs.chmodSync(bcPath, origMode | 0o200); } catch { /* */ }
  fs.writeFileSync(bcPath, buf);
  try { fs.chmodSync(bcPath, origMode); } catch { /* */ }
  return true;
}
