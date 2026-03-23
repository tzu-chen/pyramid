import { useEffect, useRef, useCallback } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Extension, Compartment } from '@codemirror/state';
import { ViewPlugin, ViewUpdate } from '@codemirror/view';
import { python } from '@codemirror/lang-python';
import { cpp } from '@codemirror/lang-cpp';
import { StreamLanguage, LanguageSupport, StringStream } from '@codemirror/language';
import { linter } from '@codemirror/lint';
import { oneDark } from '@codemirror/theme-one-dark';
import { useTheme } from '../../contexts/ThemeContext';
import styles from './CodeEditor.module.css';

// --- Lean 4 Syntax Highlighting ---

const leanKeywords = new Set([
  'theorem', 'lemma', 'def', 'definition', 'structure', 'inductive', 'class',
  'instance', 'where', 'by', 'sorry', 'exact', 'apply', 'intro', 'intros',
  'cases', 'induction', 'simp', 'rw', 'rewrite', 'have', 'let', 'show',
  'suffices', 'calc', 'match', 'with', 'do', 'return', 'if', 'then', 'else',
  'import', 'open', 'namespace', 'section', 'end', 'variable', 'axiom',
  'noncomputable', 'private', 'protected', 'mutual', 'partial', 'unsafe',
  'example', 'set_option', 'attribute', 'deriving', 'extends', 'abbrev',
  'opaque', 'macro', 'syntax', 'elab', 'scoped', 'local', 'prefix',
  'infixl', 'infixr', 'notation', 'postfix', 'universe', 'fun', 'assume',
  'Type', 'Prop', 'Sort', 'true', 'false', 'True', 'False',
  'rfl', 'And', 'Or', 'Not', 'Iff', 'Exists',
  'ring', 'linarith', 'omega', 'norm_num', 'decide', 'trivial',
  'constructor', 'left', 'right', 'ext', 'congr', 'funext',
  'contradiction', 'absurd', 'exfalso', 'push_neg', 'norm_cast',
  'field_simp', 'ring_nf', 'simp_all', 'aesop', 'tauto',
  'rcases', 'obtain', 'rintro', 'refine', 'use',
]);

const leanBuiltins = new Set([
  'Nat', 'Int', 'Float', 'String', 'Bool', 'List', 'Array', 'Option',
  'Unit', 'Prod', 'Sum', 'Fin', 'Char', 'IO', 'Monad', 'Functor',
  'Pure', 'Bind', 'StateT', 'ReaderT', 'ExceptT',
]);

interface LeanState {
  inBlockComment: number;
  inString: boolean;
}

const leanStreamDef = {
  startState(): LeanState {
    return { inBlockComment: 0, inString: false };
  },
  token(stream: StringStream, state: LeanState): string | null {
    // Block comment
    if (state.inBlockComment > 0) {
      if (stream.match('/-')) {
        state.inBlockComment++;
        return 'comment';
      }
      if (stream.match('-/')) {
        state.inBlockComment--;
        return 'comment';
      }
      stream.next();
      return 'comment';
    }

    // String
    if (state.inString) {
      if (stream.match(/^[^"\\]+/)) return 'string';
      if (stream.match(/^\\./)) return 'string';
      if (stream.match('"')) { state.inString = false; return 'string'; }
      stream.next();
      return 'string';
    }

    // Start block comment
    if (stream.match('/-')) {
      state.inBlockComment = 1;
      return 'comment';
    }

    // Line comment
    if (stream.match('--')) {
      stream.skipToEnd();
      return 'comment';
    }

    // Lean directives (#check, #eval, #print, etc.)
    if (stream.match(/#\w+/)) {
      return 'meta';
    }

    // String start
    if (stream.match('"')) {
      state.inString = true;
      return 'string';
    }

    // Char literal
    if (stream.match(/'[^'\\]'/)) return 'string';
    if (stream.match(/'\\.[^']*'/)) return 'string';

    // Number
    if (stream.match(/^0[xX][0-9a-fA-F_]+/)) return 'number';
    if (stream.match(/^0[bB][01_]+/)) return 'number';
    if (stream.match(/^[0-9][0-9_]*(\.[0-9_]+)?([eE][+-]?[0-9_]+)?/)) return 'number';

    // Operators
    if (stream.match(/^[+\-*/%=<>!&|^~?@$.:∀∃λ→←↔⟨⟩∧∨¬≤≥≠∈∉⊂⊃⊆⊇∪∩×⊕⊗•∘≈≡⊢⊣▸▹◂◃]/)) {
      return 'operator';
    }

    // Identifiers and keywords
    if (stream.match(/^[a-zA-Zα-ωΑ-Ω_\u2070-\u209f\u1d00-\u1dbf][a-zA-Z0-9α-ωΑ-Ω_'\u2070-\u209f\u1d00-\u1dbf]*/)) {
      const word = stream.current();
      if (leanKeywords.has(word)) return 'keyword';
      if (leanBuiltins.has(word)) return 'typeName';
      if (word[0] >= 'A' && word[0] <= 'Z') return 'typeName';
      return 'variableName';
    }

    // Unicode identifiers (ℝ, ℕ, ℤ, etc.)
    if (stream.match(/^[\u2100-\u214f\u2200-\u22ff]/)) {
      return 'variableName';
    }

    stream.next();
    return null;
  },
};

function leanLanguage(): LanguageSupport {
  return new LanguageSupport(StreamLanguage.define(leanStreamDef));
}

// --- Unicode Input Extension ---

const UNICODE_MAP: Record<string, string> = {
  '\\forall': '\u2200', '\\exists': '\u2203', '\\lam': '\u03BB', '\\fun': '\u03BB',
  '\\to': '\u2192', '\\rightarrow': '\u2192', '\\leftarrow': '\u2190', '\\iff': '\u2194',
  '\\leftrightarrow': '\u2194', '\\mapsto': '\u21A6',
  '\\R': '\u211D', '\\N': '\u2115', '\\Z': '\u2124', '\\Q': '\u211A', '\\C': '\u2102',
  '\\alpha': '\u03B1', '\\beta': '\u03B2', '\\gamma': '\u03B3', '\\delta': '\u03B4',
  '\\epsilon': '\u03B5', '\\varepsilon': '\u03B5', '\\zeta': '\u03B6', '\\eta': '\u03B7',
  '\\theta': '\u03B8', '\\iota': '\u03B9', '\\kappa': '\u03BA', '\\mu': '\u03BC',
  '\\nu': '\u03BD', '\\xi': '\u03BE', '\\pi': '\u03C0', '\\rho': '\u03C1',
  '\\sigma': '\u03C3', '\\tau': '\u03C4', '\\upsilon': '\u03C5', '\\phi': '\u03C6',
  '\\varphi': '\u03C6', '\\chi': '\u03C7', '\\psi': '\u03C8', '\\omega': '\u03C9',
  '\\Gamma': '\u0393', '\\Delta': '\u0394', '\\Theta': '\u0398', '\\Lambda': '\u039B',
  '\\Xi': '\u039E', '\\Pi': '\u03A0', '\\Sigma': '\u03A3', '\\Phi': '\u03A6',
  '\\Psi': '\u03A8', '\\Omega': '\u03A9',
  '\\in': '\u2208', '\\notin': '\u2209', '\\ni': '\u220B',
  '\\sub': '\u2282', '\\sup': '\u2283', '\\sube': '\u2286', '\\supe': '\u2287',
  '\\subset': '\u2282', '\\supset': '\u2283', '\\subseteq': '\u2286', '\\supseteq': '\u2287',
  '\\and': '\u2227', '\\or': '\u2228', '\\not': '\u00AC', '\\neg': '\u00AC',
  '\\ne': '\u2260', '\\neq': '\u2260', '\\le': '\u2264', '\\ge': '\u2265',
  '\\leq': '\u2264', '\\geq': '\u2265', '\\lt': '<', '\\gt': '>',
  '\\inf': '\u221E', '\\infty': '\u221E', '\\infinity': '\u221E',
  '\\times': '\u00D7', '\\cross': '\u00D7', '\\cdot': '\u00B7', '\\circ': '\u2218',
  '\\comp': '\u2218', '\\oplus': '\u2295', '\\otimes': '\u2297',
  '\\union': '\u222A', '\\inter': '\u2229', '\\cup': '\u222A', '\\cap': '\u2229',
  '\\empty': '\u2205', '\\emptyset': '\u2205',
  '\\langle': '\u27E8', '\\rangle': '\u27E9', '\\lang': '\u27E8', '\\rang': '\u27E9',
  '\\vdash': '\u22A2', '\\dashv': '\u22A3', '\\models': '\u22A8',
  '\\top': '\u22A4', '\\bot': '\u22A5',
  '\\partial': '\u2202', '\\nabla': '\u2207', '\\sum': '\u2211', '\\prod': '\u220F',
  '\\int': '\u222B',
  '\\equiv': '\u2261', '\\approx': '\u2248', '\\cong': '\u2245', '\\sim': '\u223C',
  '\\pm': '\u00B1', '\\mp': '\u2213',
  '\\b0': '\u2080', '\\b1': '\u2081', '\\b2': '\u2082', '\\b3': '\u2083',
  '\\b4': '\u2084', '\\b5': '\u2085', '\\b6': '\u2086', '\\b7': '\u2087',
  '\\b8': '\u2088', '\\b9': '\u2089',
  '\\0': '\u2070', '\\1': '\u00B9', '\\2': '\u00B2', '\\3': '\u00B3',
  '\\4': '\u2074', '\\5': '\u2075', '\\6': '\u2076', '\\7': '\u2077',
  '\\8': '\u2078', '\\9': '\u2079',
  '\\l': '\u2113',
  '\\triangle': '\u25B3', '\\square': '\u25A1',
  '\\star': '\u22C6', '\\bullet': '\u2022',
};

function unicodeInputExtension(): Extension {
  return ViewPlugin.fromClass(class {
    update(update: ViewUpdate) {
      if (!update.docChanged) return;
      const view = update.view;

      update.transactions.forEach(tr => {
        if (!tr.docChanged) return;
        tr.changes.iterChanges((_fromA, _toA, _fromB, toB) => {
          // Look backwards from insertion point for a backslash sequence
          const line = view.state.doc.lineAt(toB);
          const textBefore = line.text.slice(0, toB - line.from);

          // Find the last backslash
          const bsIdx = textBefore.lastIndexOf('\\');
          if (bsIdx === -1) return;

          const candidate = textBefore.slice(bsIdx);

          // Check if candidate ends with a space (trigger) or is in the map
          if (candidate.endsWith(' ')) {
            const key = candidate.slice(0, -1);
            const replacement = UNICODE_MAP[key];
            if (replacement) {
              const from = line.from + bsIdx;
              const to = line.from + bsIdx + candidate.length;
              // Schedule the replacement after current update
              setTimeout(() => {
                view.dispatch({
                  changes: { from, to, insert: replacement },
                });
              }, 0);
            }
          }
        });
      });
    }
  });
}

// --- LSP Diagnostics Extension ---

export interface LspDiagnostic {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  message: string;
  severity?: number; // 1=Error, 2=Warning, 3=Info, 4=Hint
}

// --- Main Component ---

interface CodeEditorProps {
  value: string;
  language: string;
  onChange: (value: string) => void;
  onCursorChange?: (position: { line: number; character: number }) => void;
  diagnostics?: LspDiagnostic[];
  readOnly?: boolean;
}

function getLanguageExtension(language: string) {
  switch (language) {
    case 'python': return python();
    case 'cpp': return cpp();
    case 'julia': return python(); // Close enough syntax for basic highlighting
    case 'lean': return leanLanguage();
    default: return python();
  }
}

function CodeEditor({ value, language, onChange, onCursorChange, diagnostics, readOnly = false }: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const diagnosticsCompartment = useRef(new Compartment());
  const { scheme } = useTheme();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onCursorChangeRef = useRef(onCursorChange);
  onCursorChangeRef.current = onCursorChange;

  const createEditor = useCallback(() => {
    if (!containerRef.current) return;

    if (viewRef.current) {
      viewRef.current.destroy();
    }

    const extensions: Extension[] = [
      basicSetup,
      getLanguageExtension(language),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current(update.state.doc.toString());
        }
        if (update.selectionSet && onCursorChangeRef.current) {
          const pos = update.state.selection.main.head;
          const line = update.state.doc.lineAt(pos);
          onCursorChangeRef.current({
            line: line.number - 1, // 0-indexed for LSP
            character: pos - line.from,
          });
        }
      }),
    ];

    if (language === 'lean') {
      extensions.push(unicodeInputExtension());
    }

    if (scheme.type === 'dark') {
      extensions.push(oneDark);
    }

    if (readOnly) {
      extensions.push(EditorState.readOnly.of(true));
    }

    // LSP diagnostics via compartment — updates without recreating editor
    extensions.push(diagnosticsCompartment.current.of([]));

    const state = EditorState.create({
      doc: value,
      extensions,
    });

    viewRef.current = new EditorView({
      state,
      parent: containerRef.current,
    });
  }, [language, scheme, readOnly]);

  useEffect(() => {
    createEditor();
    return () => {
      viewRef.current?.destroy();
    };
  }, [createEditor]);

  // Update diagnostics without recreating the editor
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !diagnostics) return;

    const linterExt = linter((editorView) => {
      return diagnostics.map(d => {
        const doc = editorView.state.doc;
        const startLine = Math.min(d.range.start.line + 1, doc.lines);
        const endLine = Math.min(d.range.end.line + 1, doc.lines);
        const sl = doc.line(startLine);
        const el = doc.line(endLine);
        const from = sl.from + Math.min(d.range.start.character, sl.length);
        const to = el.from + Math.min(d.range.end.character, el.length);
        const severityMap: Record<number, 'error' | 'warning' | 'info'> = {
          1: 'error', 2: 'warning', 3: 'info', 4: 'info',
        };
        return {
          from: Math.max(0, from),
          to: Math.max(from, to),
          severity: severityMap[d.severity || 1] || 'error',
          message: d.message,
        };
      });
    }, { delay: 0 });

    view.dispatch({
      effects: diagnosticsCompartment.current.reconfigure(linterExt),
    });
  }, [diagnostics]);

  // Update content from outside
  useEffect(() => {
    if (viewRef.current) {
      const currentValue = viewRef.current.state.doc.toString();
      if (currentValue !== value) {
        viewRef.current.dispatch({
          changes: {
            from: 0,
            to: currentValue.length,
            insert: value,
          },
        });
      }
    }
  }, [value]);

  return <div ref={containerRef} className={styles.editor} />;
}

export default CodeEditor;
