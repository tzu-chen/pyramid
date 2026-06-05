// Session type domain. Lean and Notebook are distinct, structured session types;
// every other type is a "freeform-like" language session (python/cpp/ocaml/julia)
// that shares the same single-file/project workbench, terminal, and LSP plumbing.
export const FREEFORM_SESSION_TYPES = ['python', 'cpp', 'ocaml', 'julia'] as const;

export type FreeformSessionType = (typeof FREEFORM_SESSION_TYPES)[number];
export type SessionType = FreeformSessionType | 'lean' | 'notebook';

// True for any language session that gets the freeform workbench (terminal,
// clangd/ocaml LSP, CMake/dune, artifact browser). Everything that isn't Lean
// or Notebook qualifies, so newly added languages need no change here.
export function isFreeformType(sessionType: string): boolean {
  return sessionType !== 'lean' && sessionType !== 'notebook';
}

// Language a session of a given type should run as. For the freeform language
// types the language mirrors the type; lean/notebook have fixed languages.
export function languageForType(sessionType: string): string {
  if (sessionType === 'lean') return 'lean';
  if (sessionType === 'notebook') return 'python';
  return sessionType; // python | cpp | ocaml | julia
}
