import { useEffect, useRef, useCallback, MutableRefObject } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Extension, Compartment, Prec } from '@codemirror/state';
import { ViewPlugin, ViewUpdate, keymap, hoverTooltip, Tooltip } from '@codemirror/view';
import { python, pythonLanguage, localCompletionSource, globalCompletion } from '@codemirror/lang-python';
import { cpp, cppLanguage } from '@codemirror/lang-cpp';
import { StreamLanguage, LanguageSupport, StringStream } from '@codemirror/language';
import { linter } from '@codemirror/lint';
import { indentMore, indentLess } from '@codemirror/commands';
import { acceptCompletion, completionStatus, startCompletion, CompletionContext, CompletionResult as CMCompletionResult } from '@codemirror/autocomplete';
import { oneDark } from '@codemirror/theme-one-dark';
import { useTheme } from '../../contexts/ThemeContext';
import { UNICODE_MAP } from '../../data/unicodeSymbols';
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

export interface ExternalCompletion {
  matches: { label: string; type?: string; detail?: string }[];
  from: number; // absolute doc position where the replacement starts
  to: number;   // absolute doc position where the replacement ends
}

export type ExternalCompletionSource = (code: string, cursorPos: number) => Promise<ExternalCompletion | null>;

export interface ExternalHoverResult {
  contents: string;
}

export type ExternalHoverSource = (line: number, character: number) => Promise<ExternalHoverResult | null>;

interface CodeEditorProps {
  value: string;
  language: string;
  onChange: (value: string) => void;
  onCursorChange?: (position: { line: number; character: number }) => void;
  diagnostics?: LspDiagnostic[];
  readOnly?: boolean;
  fontSize?: number;
  onInsertRef?: MutableRefObject<((text: string) => void) | null>;
  onJumpRef?: MutableRefObject<((line: number, column: number) => void) | null>;
  externalCompletion?: ExternalCompletionSource;
  externalHover?: ExternalHoverSource;
}

function pythonWithCompletion(): Extension {
  return [
    python(),
    pythonLanguage.data.of({ autocomplete: localCompletionSource }),
    pythonLanguage.data.of({ autocomplete: globalCompletion }),
  ];
}

function getLanguageExtension(language: string): Extension {
  switch (language) {
    case 'python': return pythonWithCompletion();
    case 'cpp': return cpp();
    case 'julia': return pythonWithCompletion(); // Close enough syntax for basic highlighting
    case 'lean': return leanLanguage();
    default: return pythonWithCompletion();
  }
}

// Tab keymap: accept active completion, else indent the selection.
// Shift+Tab dedents. Ctrl/Cmd+Space opens completions.
// Highest precedence so Tab does not move focus out of the editor.
const tabKeymap = Prec.highest(keymap.of([
  {
    key: 'Tab',
    run: (view) => {
      if (completionStatus(view.state) === 'active') return acceptCompletion(view);
      return indentMore(view);
    },
    shift: indentLess,
  },
  { key: 'Mod-Space', run: startCompletion },
]));

function CodeEditor({ value, language, onChange, onCursorChange, diagnostics, readOnly = false, fontSize, onInsertRef, onJumpRef, externalCompletion, externalHover }: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const diagnosticsCompartment = useRef(new Compartment());
  const fontSizeCompartment = useRef(new Compartment());
  const fontSizeRef = useRef(fontSize);
  const { scheme } = useTheme();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onCursorChangeRef = useRef(onCursorChange);
  onCursorChangeRef.current = onCursorChange;
  const externalCompletionRef = useRef(externalCompletion);
  externalCompletionRef.current = externalCompletion;
  const externalHoverRef = useRef(externalHover);
  externalHoverRef.current = externalHover;

  const createEditor = useCallback(() => {
    if (!containerRef.current) return;

    if (viewRef.current) {
      viewRef.current.destroy();
    }

    const extensions: Extension[] = [
      basicSetup,
      tabKeymap,
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

    if (language === 'python' || language === 'julia' || language === 'cpp') {
      const externalSource = async (ctx: CompletionContext): Promise<CMCompletionResult | null> => {
        const fn = externalCompletionRef.current;
        if (!fn) return null;
        // Trigger on word char, '.', or explicit invocation. C++ also triggers on '>' (->) and ':' (::).
        const before = ctx.state.sliceDoc(Math.max(0, ctx.pos - 1), ctx.pos);
        const before2 = ctx.state.sliceDoc(Math.max(0, ctx.pos - 2), ctx.pos);
        const isWord = /\w/.test(before);
        const isDot = before === '.';
        const isArrow = before2 === '->';
        const isScope = before2 === '::';
        if (!ctx.explicit && !isWord && !isDot && !isArrow && !isScope) return null;
        const code = ctx.state.doc.toString();
        const result = await fn(code, ctx.pos);
        if (!result || result.matches.length === 0) return null;
        return {
          from: result.from,
          to: result.to,
          options: result.matches.map(m => ({
            label: m.label,
            type: m.type,
            detail: m.detail,
          })),
          validFor: /^[\w.]*$/,
        };
      };
      const langData = language === 'cpp' ? cppLanguage.data : pythonLanguage.data;
      extensions.push(langData.of({ autocomplete: externalSource }));
    }

    // External hover (LSP-backed) — currently used by C++/clangd
    extensions.push(hoverTooltip(async (view, pos): Promise<Tooltip | null> => {
      const fn = externalHoverRef.current;
      if (!fn) return null;
      const line = view.state.doc.lineAt(pos);
      const character = pos - line.from;
      const result = await fn(line.number - 1, character);
      if (!result || !result.contents) return null;
      return {
        pos,
        above: true,
        create() {
          const dom = document.createElement('div');
          dom.className = 'cm-tooltip-hover-content';
          dom.style.padding = '6px 10px';
          dom.style.maxWidth = '480px';
          dom.style.fontFamily = 'var(--font-mono, monospace)';
          dom.style.fontSize = '12px';
          dom.style.whiteSpace = 'pre-wrap';
          dom.style.lineHeight = '1.4';
          dom.textContent = result.contents;
          return { dom };
        },
      };
    }, { hideOnChange: true }));

    if (scheme.type === 'dark') {
      extensions.push(oneDark);
    }

    if (readOnly) {
      extensions.push(EditorState.readOnly.of(true));
    }

    // Font size via compartment — updates without recreating editor
    const fs = fontSizeRef.current || 13;
    extensions.push(fontSizeCompartment.current.of(
      EditorView.theme({ '.cm-scroller': { fontSize: `${fs}px` } })
    ));

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

  // Expose insert function for external symbol insertion
  useEffect(() => {
    if (onInsertRef) {
      onInsertRef.current = (text: string) => {
        const view = viewRef.current;
        if (!view) return;
        const { from } = view.state.selection.main;
        view.dispatch({
          changes: { from, to: from, insert: text },
          selection: { anchor: from + text.length },
        });
        view.focus();
      };
    }
    return () => {
      if (onInsertRef) onInsertRef.current = null;
    };
  }, [onInsertRef, createEditor]);

  // Expose a jump-to function so external panels (e.g. build diagnostics) can
  // navigate to a specific 1-indexed line/column.
  useEffect(() => {
    if (onJumpRef) {
      onJumpRef.current = (line: number, column: number) => {
        const view = viewRef.current;
        if (!view) return;
        const doc = view.state.doc;
        const lineNo = Math.max(1, Math.min(line, doc.lines));
        const lineInfo = doc.line(lineNo);
        const pos = lineInfo.from + Math.max(0, Math.min(column - 1, lineInfo.length));
        view.dispatch({
          selection: { anchor: pos, head: pos },
          scrollIntoView: true,
          effects: EditorView.scrollIntoView(pos, { y: 'center' }),
        });
        view.focus();
      };
    }
    return () => {
      if (onJumpRef) onJumpRef.current = null;
    };
  }, [onJumpRef, createEditor]);

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

  // Update font size without recreating the editor
  useEffect(() => {
    fontSizeRef.current = fontSize;
    const view = viewRef.current;
    if (!view || !fontSize) return;
    view.dispatch({
      effects: fontSizeCompartment.current.reconfigure(
        EditorView.theme({ '.cm-scroller': { fontSize: `${fontSize}px` } })
      ),
    });
  }, [fontSize]);

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
