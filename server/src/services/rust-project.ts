import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// Cargo crate names must be valid identifiers (`[a-z][a-z0-9_-]*`-ish). Derive a
// safe slug from the session title; fall back to a generic name when nothing
// usable survives sanitisation.
function sanitizeCrateName(title: string): string {
  const slug = (title || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  if (!slug) return 'pyramid_session';
  if (!/^[a-z]/.test(slug)) return `crate_${slug}`.slice(0, 64);
  return slug;
}

const DEFAULT_MAIN = `fn main() {
    println!("Hello from Pyramid!");
}
`;

// Hand-write a minimal Cargo package when `cargo` isn't on PATH, so a Rust
// session still has a manifest for rust-analyzer to anchor to (builds will fail
// later with a clear "cargo not found" error, which is the honest outcome).
function writeFallbackProject(projectPath: string, name: string): void {
  const cargoToml = `[package]
name = "${name}"
version = "0.1.0"
edition = "2021"

[dependencies]
`;
  fs.writeFileSync(path.join(projectPath, 'Cargo.toml'), cargoToml);
  const srcDir = path.join(projectPath, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  const mainPath = path.join(srcDir, 'main.rs');
  if (!fs.existsSync(mainPath)) fs.writeFileSync(mainPath, DEFAULT_MAIN);
}

export const rustProject = {
  /**
   * Bring a Rust session's working dir to a ready Cargo package (Cargo.toml +
   * src/main.rs). Idempotent — safe to call on create and on every /ws/rust
   * connect, so sessions created before this feature get promoted on reopen.
   * `cargo init` is fast and offline (no dependency download), so this runs
   * synchronously; no background status table is needed (unlike Lean/Python).
   */
  ensureCargoProject(projectPath: string, title: string): void {
    if (!fs.existsSync(projectPath)) {
      fs.mkdirSync(projectPath, { recursive: true });
    }
    if (fs.existsSync(path.join(projectPath, 'Cargo.toml'))) return; // already a package

    const name = sanitizeCrateName(title);
    const r = spawnSync(
      'cargo',
      ['init', '--name', name, '--bin', '--vcs', 'none'],
      { cwd: projectPath, timeout: 30000, encoding: 'utf8' }
    );
    if (r.error || r.status !== 0) {
      writeFallbackProject(projectPath, name);
    }
  },
};
