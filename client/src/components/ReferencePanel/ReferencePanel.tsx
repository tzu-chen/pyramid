import { useState, useEffect, useMemo, useRef } from 'react';
import styles from './ReferencePanel.module.css';

// One embeddable API-reference site.
export interface ReferenceSource {
  id: string;
  label: string;
  url: string;
  description: string;
  // false = the site refuses to be framed (X-Frame-Options / CSP
  // frame-ancestors). The browser enforces this and there is no client-side
  // override, so we show an "open in new tab" card instead of a dead iframe.
  embeddable?: boolean;
}

// Catalog of API-reference sites keyed by session language. Notebook sessions
// are Python (Jupyter), so the caller maps them onto the 'python' catalog.
// These are all static-hosted doc sites (GitHub Pages, Read-the-Docs, Fastly)
// that do not send X-Frame-Options, so they embed in an <iframe>. The panel
// always offers an "Open in new tab" fallback for any site that refuses.
const CATALOG: Record<string, ReferenceSource[]> = {
  python: [
    { id: 'py-stdlib', label: 'Python', url: 'https://docs.python.org/3/', description: 'Language & standard library reference' },
    { id: 'numpy', label: 'NumPy', url: 'https://numpy.org/doc/stable/reference/index.html', description: 'NumPy API reference' },
    { id: 'pandas', label: 'pandas', url: 'https://pandas.pydata.org/docs/reference/index.html', description: 'pandas API reference' },
    { id: 'scipy', label: 'SciPy', url: 'https://docs.scipy.org/doc/scipy/reference/index.html', description: 'SciPy API reference' },
    { id: 'matplotlib', label: 'Matplotlib', url: 'https://matplotlib.org/stable/api/index.html', description: 'Matplotlib API reference', embeddable: false },
    { id: 'sympy', label: 'SymPy', url: 'https://docs.sympy.org/latest/reference/index.html', description: 'SymPy symbolic-math API' },
    { id: 'sklearn', label: 'scikit-learn', url: 'https://scikit-learn.org/stable/api/index.html', description: 'scikit-learn API reference' },
    { id: 'pytorch', label: 'PyTorch', url: 'https://pytorch.org/docs/stable/index.html', description: 'PyTorch API documentation' },
    { id: 'jax', label: 'JAX', url: 'https://jax.readthedocs.io/en/latest/', description: 'JAX API documentation' },
  ],
  julia: [
    { id: 'julia', label: 'Julia', url: 'https://docs.julialang.org/en/v1/', description: 'Julia language documentation' },
    { id: 'julia-base', label: 'Julia Base', url: 'https://docs.julialang.org/en/v1/base/base/', description: 'Julia Base module reference' },
    { id: 'julia-stdlib', label: 'Std Library', url: 'https://docs.julialang.org/en/v1/stdlib/Statistics/', description: 'Julia standard library reference' },
    { id: 'sciml', label: 'SciML / DiffEq', url: 'https://docs.sciml.ai/DiffEqDocs/stable/', description: 'DifferentialEquations.jl (SciML) docs' },
    { id: 'plots-jl', label: 'Plots.jl', url: 'https://docs.juliaplots.org/stable/', description: 'Plots.jl plotting reference' },
  ],
  cpp: [
    { id: 'cppref', label: 'cppreference', url: 'https://en.cppreference.com/w/cpp', description: 'C++ language & library reference' },
    { id: 'cpp-headers', label: 'C++ Headers', url: 'https://en.cppreference.com/w/cpp/header.html', description: 'Standard library headers index' },
    { id: 'eigen', label: 'Eigen', url: 'https://eigen.tuxfamily.org/dox/', description: 'Eigen linear-algebra library' },
    { id: 'boost', label: 'Boost', url: 'https://www.boost.org/doc/libs/', description: 'Boost C++ libraries documentation', embeddable: false },
    { id: 'cpp-guidelines', label: 'Core Guidelines', url: 'https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines', description: 'C++ Core Guidelines' },
  ],
  ocaml: [
    { id: 'ocaml-manual', label: 'OCaml Manual', url: 'https://ocaml.org/manual/', description: 'The OCaml manual' },
    { id: 'ocaml-stdlib', label: 'OCaml Stdlib', url: 'https://v2.ocaml.org/api/index.html', description: 'OCaml standard library API' },
    { id: 'ocaml-pkgs', label: 'opam Packages', url: 'https://ocaml.org/packages', description: 'OCaml package documentation' },
    { id: 'ocaml-base', label: 'Jane St. Base', url: 'https://ocaml.org/p/base/latest/doc/index.html', description: 'Jane Street Base stdlib replacement' },
    { id: 'rwo', label: 'Real World OCaml', url: 'https://dev.realworldocaml.org/', description: 'Real World OCaml (book)' },
  ],
  lean: [
    { id: 'mathlib', label: 'Mathlib4', url: 'https://leanprover-community.github.io/mathlib4_docs/', description: 'Mathlib4 API documentation' },
    { id: 'loogle', label: 'Loogle', url: 'https://loogle.lean-lang.org/', description: 'Search Mathlib/Lean by name, type, or pattern' },
    { id: 'lean-docs', label: 'Lean Docs', url: 'https://lean-lang.org/documentation/', description: 'Lean documentation hub' },
    { id: 'tpil', label: 'Theorem Proving', url: 'https://leanprover.github.io/theorem_proving_in_lean4/', description: 'Theorem Proving in Lean 4' },
    { id: 'mil', label: 'Mathematics in Lean', url: 'https://leanprover-community.github.io/mathematics_in_lean/', description: 'Mathematics in Lean tutorial' },
    { id: 'fpil', label: 'FP in Lean', url: 'https://leanprover.github.io/functional_programming_in_lean/', description: 'Functional Programming in Lean' },
    { id: 'lean-community', label: 'Lean Community', url: 'https://leanprover-community.github.io/', description: 'Lean community site & tactic docs' },
  ],
};

// Pure lookup so callers (e.g. SessionPage) can decide whether to show the tab.
export function getReferenceSources(language: string): ReferenceSource[] {
  return CATALOG[language] ?? [];
}

interface ReferencePanelProps {
  sessionId: string;
  sources: ReferenceSource[];
}

interface PersistedState {
  openIds: string[];
  activeId: string | null;
}

function ReferencePanel({ sessionId, sources }: ReferencePanelProps) {
  const storageKey = `pyramid_reference_${sessionId}`;

  // Which sources have an <iframe> mounted, and which is shown.
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // The catalog picker is shown when nothing is open, or on demand via "+".
  const [pickerOpen, setPickerOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // Guards the persist effect so it doesn't fire during the restore pass.
  const loadedRef = useRef(false);

  // Restore the open set for this session. Re-runs only when the session or the
  // (memoized) source list changes — i.e. when navigating to a different session.
  useEffect(() => {
    loadedRef.current = false;
    let restored: PersistedState | null = null;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) restored = JSON.parse(raw);
    } catch { /* ignore malformed */ }

    const valid = new Set(sources.map(s => s.id));
    const open = (restored?.openIds ?? []).filter(id => valid.has(id));
    // With a single applicable page there's nothing to choose — open it.
    if (open.length === 0 && sources.length === 1) open.push(sources[0].id);

    const restoredActive = restored?.activeId ?? null;
    setOpenIds(open);
    setActiveId(restoredActive && open.includes(restoredActive) ? restoredActive : (open[0] ?? null));
    setPickerOpen(open.length === 0);
    setPicked(new Set());
    loadedRef.current = true;
  }, [sessionId, sources, storageKey]);

  // Persist after any user-driven change.
  useEffect(() => {
    if (!loadedRef.current) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ openIds, activeId }));
    } catch { /* ignore quota errors */ }
  }, [openIds, activeId, storageKey]);

  const byId = useMemo(() => new Map(sources.map(s => [s.id, s])), [sources]);
  const openSources = openIds.map(id => byId.get(id)).filter((s): s is ReferenceSource => !!s);
  const hasUnopened = sources.some(s => !openIds.includes(s.id));

  const closeSource = (id: string) => {
    setOpenIds(prev => {
      const next = prev.filter(x => x !== id);
      setActiveId(curr => (curr === id ? (next[next.length - 1] ?? null) : curr));
      if (next.length === 0) setPickerOpen(true);
      return next;
    });
  };

  const openPicked = () => {
    const toOpen = sources.filter(s => picked.has(s.id) && !openIds.includes(s.id)).map(s => s.id);
    if (toOpen.length === 0) return;
    setOpenIds(prev => [...prev, ...toOpen]);
    setActiveId(toOpen[0]);
    setPicked(new Set());
    setPickerOpen(false);
  };

  const togglePicked = (id: string) => {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (sources.length === 0) {
    return <div className={styles.placeholder}>No reference pages available for this session.</div>;
  }

  const activeSource = activeId ? byId.get(activeId) : undefined;

  return (
    <div className={styles.panel}>
      <div className={styles.bar}>
        {openSources.map(s => (
          <div
            key={s.id}
            className={`${styles.refTab} ${!pickerOpen && activeId === s.id ? styles.refTabActive : ''}`}
            onClick={() => { setActiveId(s.id); setPickerOpen(false); }}
            title={s.description}
          >
            <span className={styles.refTabLabel}>{s.label}</span>
            <button
              className={styles.refTabClose}
              onClick={(e) => { e.stopPropagation(); closeSource(s.id); }}
              title={`Close ${s.label}`}
            >
              &times;
            </button>
          </div>
        ))}
        {hasUnopened && (
          <button
            className={`${styles.refTab} ${styles.addTab} ${pickerOpen ? styles.refTabActive : ''}`}
            onClick={() => setPickerOpen(p => !p)}
            title="Open another reference"
          >
            +
          </button>
        )}
        <span className={styles.barSpacer} />
        {!pickerOpen && activeSource && (
          <a
            className={styles.externalLink}
            href={activeSource.url}
            target="_blank"
            rel="noreferrer"
            title="Open this page in a new browser tab"
          >
            Open in new tab ↗
          </a>
        )}
      </div>

      <div className={styles.body}>
        {/* Iframes stay mounted so scroll position / navigation survive tab
            switches. Sites that block framing get a card with a new-tab link. */}
        {openSources.map(s => {
          const shown = !pickerOpen && activeId === s.id;
          if (s.embeddable === false) {
            return (
              <div key={s.id} className={styles.card} style={{ display: shown ? 'flex' : 'none' }}>
                <div className={styles.cardTitle}>{s.label} can’t be embedded</div>
                <div className={styles.cardText}>
                  {s.label} blocks display inside other apps (X-Frame-Options / CSP),
                  so it can’t render here. Open it in a separate browser tab instead.
                </div>
                <a className={styles.cardBtn} href={s.url} target="_blank" rel="noreferrer">
                  Open {s.label} in new tab ↗
                </a>
              </div>
            );
          }
          return (
            <iframe
              key={s.id}
              className={styles.frame}
              src={s.url}
              title={s.label}
              style={{ display: shown ? 'block' : 'none' }}
              referrerPolicy="no-referrer-when-downgrade"
            />
          );
        })}

        {pickerOpen && (
          <div className={styles.picker}>
            <div className={styles.pickerTitle}>Open API reference</div>
            <div className={styles.pickerList}>
              {sources.map(s => {
                const alreadyOpen = openIds.includes(s.id);
                return (
                  <label key={s.id} className={styles.pickerItem}>
                    <input
                      type="checkbox"
                      checked={alreadyOpen || picked.has(s.id)}
                      disabled={alreadyOpen}
                      onChange={() => togglePicked(s.id)}
                    />
                    <span className={styles.pickerLabel}>{s.label}</span>
                    <span className={styles.pickerDesc}>
                      {s.description}
                      {alreadyOpen ? ' (open)' : s.embeddable === false ? ' · opens in new tab' : ''}
                    </span>
                  </label>
                );
              })}
            </div>
            <div className={styles.pickerActions}>
              <button className={styles.openBtn} onClick={openPicked} disabled={picked.size === 0}>
                Open selected
              </button>
              {openSources.length > 0 && (
                <button
                  className={styles.cancelBtn}
                  onClick={() => { setPickerOpen(false); setPicked(new Set()); }}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ReferencePanel;
