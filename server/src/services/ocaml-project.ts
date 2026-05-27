import fs from 'fs';
import path from 'path';

// Minimal .ocamlformat so `ocamllsp` knows how to handle formatting requests
// without complaining; users can edit it freely. Pinning a version keeps the
// formatter from rejecting the file on a newer ocamlformat install.
const DEFAULT_OCAMLFORMAT = `version = 0.26.2
profile = default
margin = 100
`;

// A .merlin so ocamllsp / merlin behave reasonably on loose files in a
// single-file session (no dune-project). The package list intentionally stays
// empty — users can add `PKG <name>` lines as they install opam libs.
const DEFAULT_MERLIN = `# .merlin — fallback config for loose-file OCaml sessions.
# When you scaffold a dune project here, merlin/ocamllsp pick up dune's
# generated config automatically and this file is ignored.
S .
B .
FLG -w +a-4-9-40..42-44-45-48-58-66-67-68-69-70
`;

export const ocamlProject = {
  /**
   * Drop sensible defaults at the project root for single-file OCaml sessions.
   * Idempotent — safe to call on every session open. When a dune-project is
   * present these files are unused but harmless.
   */
  ensureDefaults(projectPath: string): void {
    if (!fs.existsSync(projectPath)) {
      fs.mkdirSync(projectPath, { recursive: true });
    }
    const fmtPath = path.join(projectPath, '.ocamlformat');
    if (!fs.existsSync(fmtPath)) {
      fs.writeFileSync(fmtPath, DEFAULT_OCAMLFORMAT);
    }
    const merlinPath = path.join(projectPath, '.merlin');
    if (!fs.existsSync(merlinPath)) {
      fs.writeFileSync(merlinPath, DEFAULT_MERLIN);
    }
  },
};
