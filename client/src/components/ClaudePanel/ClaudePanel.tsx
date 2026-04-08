import { useState, useEffect, useRef } from 'react';
import { claudeService, scribeService, type ClaudeMode, type ContextBlock, type ScribeNode } from '../../services/claudeService';
import { LspDiagnostic } from '../CodeEditor/CodeEditor';
import MarkdownRenderer from '../MarkdownRenderer/MarkdownRenderer';
import { SessionLink } from '../../types';
import styles from './ClaudePanel.module.css';

interface ClaudePanelProps {
  sessionId: string;
  sessionType: 'lean' | 'freeform';
  fileContent: string;
  fileName: string;
  /** Lean diagnostics from LSP */
  diagnostics?: LspDiagnostic[];
  /** Lean goal state */
  goalState?: string | null;
  /** Latest freeform execution run */
  lastRun?: { exit_code: number | null; stdout: string; stderr: string } | null;
  /** Session cross-app links */
  links?: SessionLink[];
  /** Called when user clicks "Apply to editor" on a code block */
  onApplyCode?: (code: string) => void;
  /** If true, auto-activate error diagnosis mode */
  autoErrorMode?: boolean;
  /** Ref to focus prompt from outside */
  promptFocusRef?: React.MutableRefObject<(() => void) | null>;
}

function ClaudePanel({
  sessionId,
  sessionType,
  fileContent,
  fileName,
  diagnostics,
  goalState,
  lastRun,
  links,
  onApplyCode,
  autoErrorMode,
  promptFocusRef,
}: ClaudePanelProps) {
  const [contextBlocks, setContextBlocks] = useState<(ContextBlock & { editing?: boolean })[]>([]);
  const [mode, setMode] = useState<ClaudeMode>('general');
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState('');
  const [tokenUsage, setTokenUsage] = useState<{ input: number; output: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [addingScribe, setAddingScribe] = useState(false);
  const [scribeSearch, setScribeSearch] = useState('');
  const [scribeResults, setScribeResults] = useState<ScribeNode[]>([]);
  const [scribeSearching, setScribeSearching] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  // Expose focus function
  useEffect(() => {
    if (promptFocusRef) {
      promptFocusRef.current = () => promptRef.current?.focus();
    }
  }, [promptFocusRef]);

  // Auto-assemble context blocks when panel data changes
  useEffect(() => {
    const blocks: ContextBlock[] = [];

    // Current file — always included
    if (fileContent) {
      blocks.push({ label: `Current file: ${fileName}`, content: fileContent });
    }

    if (sessionType === 'lean') {
      // Diagnostics
      if (diagnostics && diagnostics.length > 0) {
        const diagText = diagnostics.map(d => {
          const severity = d.severity === 1 ? 'Error' : d.severity === 2 ? 'Warning' : d.severity === 3 ? 'Info' : 'Hint';
          return `[${severity}] Line ${d.range.start.line + 1}: ${d.message}`;
        }).join('\n');
        blocks.push({ label: 'Diagnostics', content: diagText });
      }

      // Goal state
      if (goalState) {
        blocks.push({ label: 'Goal state', content: goalState });
      }
    } else {
      // Freeform: last run with errors
      if (lastRun && (lastRun.exit_code !== 0 || lastRun.stderr)) {
        let output = '';
        if (lastRun.stdout) output += `stdout:\n${lastRun.stdout}\n\n`;
        if (lastRun.stderr) output += `stderr:\n${lastRun.stderr}`;
        blocks.push({ label: 'Last run output', content: output.trim() });
      }
    }

    setContextBlocks(blocks);

    // Auto-set mode based on context
    const hasErrors = sessionType === 'lean'
      ? diagnostics && diagnostics.some(d => d.severity === 1)
      : lastRun && (lastRun.exit_code !== 0 || lastRun.stderr);

    if (autoErrorMode || hasErrors) {
      setMode('error_diagnosis');
    }
  }, [fileContent, fileName, sessionType, diagnostics, goalState, lastRun, autoErrorMode]);

  // Fetch Scribe context for linked nodes
  useEffect(() => {
    if (!links) return;
    const scribeLinks = links.filter(l => l.app === 'scribe' && l.ref_type === 'flowchart_node');
    for (const link of scribeLinks) {
      // ref_id is "flowchartId:nodeKey" or just nodeKey depending on how it's stored
      // Try to fetch it as a search by label
      if (link.label) {
        scribeService.searchNodes(link.label).then(nodes => {
          if (nodes.length > 0) {
            const node = nodes[0];
            const content = formatScribeNode(node);
            setContextBlocks(prev => {
              // Don't add duplicates
              if (prev.some(b => b.label === `Scribe: ${node.title}`)) return prev;
              return [...prev, { label: `Scribe: ${node.title}`, content }];
            });
          }
        }).catch(() => {});
      }
    }
  }, [links]);

  const formatScribeNode = (node: ScribeNode): string => {
    let text = `Title: ${node.title}`;
    if (node.refs) text += `\nReferences: ${node.refs}`;
    if (node.topics) text += `\nTopics: ${node.topics}`;
    return text;
  };

  const handleRemoveBlock = (index: number) => {
    setContextBlocks(prev => prev.filter((_, i) => i !== index));
  };

  const handleToggleEdit = (index: number) => {
    setContextBlocks(prev => prev.map((b, i) => i === index ? { ...b, editing: !b.editing } : b));
  };

  const handleEditContent = (index: number, content: string) => {
    setContextBlocks(prev => prev.map((b, i) => i === index ? { ...b, content } : b));
  };

  const handleAddFreeText = () => {
    setContextBlocks(prev => [...prev, { label: 'Additional context', content: '', editing: true }]);
  };

  const handleScribeSearch = async () => {
    if (!scribeSearch.trim()) return;
    setScribeSearching(true);
    try {
      const results = await scribeService.searchNodes(scribeSearch);
      setScribeResults(results);
    } catch {
      setScribeResults([]);
    } finally {
      setScribeSearching(false);
    }
  };

  const handleAddScribeNode = (node: ScribeNode) => {
    const content = formatScribeNode(node);
    setContextBlocks(prev => [...prev, { label: `Scribe: ${node.title}`, content }]);
    setAddingScribe(false);
    setScribeSearch('');
    setScribeResults([]);
  };

  const handleSend = async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError('');

    try {
      const blocks = contextBlocks.map(({ label, content }) => ({ label, content }));
      const result = await claudeService.ask(sessionId, prompt.trim(), blocks, mode);
      setResponse(result.response);
      setTokenUsage({ input: result.input_tokens, output: result.output_tokens });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code).catch(() => {});
  };

  const modes: { value: ClaudeMode; label: string }[] = sessionType === 'lean'
    ? [
        { value: 'error_diagnosis', label: 'Error Diagnosis' },
        { value: 'formalization_help', label: 'Formalization Help' },
        { value: 'general', label: 'General' },
      ]
    : [
        { value: 'error_diagnosis', label: 'Error Diagnosis' },
        { value: 'implementation_help', label: 'Implementation Help' },
        { value: 'general', label: 'General' },
      ];

  const placeholders: Record<ClaudeMode, string> = {
    error_diagnosis: "What's wrong with this code?",
    formalization_help: 'Help me formalize this...',
    implementation_help: 'Implement this method...',
    general: 'Ask anything about your code...',
  };

  return (
    <div className={styles.panel}>
      {/* Context blocks */}
      <div className={styles.contextArea}>
        {contextBlocks.map((block, i) => (
          <div key={i} className={styles.contextBlock}>
            <div className={styles.contextHeader}>
              <span className={styles.contextLabel}>{block.label}</span>
              <div className={styles.contextActions}>
                <button className={styles.contextBtn} onClick={() => handleToggleEdit(i)} title="Edit">
                  {block.editing ? 'Done' : 'Edit'}
                </button>
                <button className={styles.contextBtn} onClick={() => handleRemoveBlock(i)} title="Remove">
                  &times;
                </button>
              </div>
            </div>
            {block.editing ? (
              <textarea
                className={styles.contextEditor}
                value={block.content}
                onChange={e => handleEditContent(i, e.target.value)}
                rows={6}
              />
            ) : (
              <pre className={styles.contextContent}>{block.content.slice(0, 500)}{block.content.length > 500 ? '...' : ''}</pre>
            )}
          </div>
        ))}
        <div className={styles.addContextRow}>
          <button className={styles.addContextBtn} onClick={handleAddFreeText}>+ Add context</button>
          <button className={styles.addContextBtn} onClick={() => setAddingScribe(!addingScribe)}>+ From Scribe</button>
        </div>

        {addingScribe && (
          <div className={styles.scribePicker}>
            <div className={styles.scribeSearchRow}>
              <input
                className={styles.scribeInput}
                type="text"
                value={scribeSearch}
                onChange={e => setScribeSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleScribeSearch()}
                placeholder="Search Scribe nodes by title..."
              />
              <button className={styles.scribeSearchBtn} onClick={handleScribeSearch} disabled={scribeSearching}>
                {scribeSearching ? '...' : 'Search'}
              </button>
            </div>
            {scribeResults.length > 0 && (
              <div className={styles.scribeResults}>
                {scribeResults.map(node => (
                  <button
                    key={node.node_key}
                    className={styles.scribeResultItem}
                    onClick={() => handleAddScribeNode(node)}
                  >
                    <span className={styles.scribeNodeTitle}>{node.title}</span>
                    {node.flowchart_name && (
                      <span className={styles.scribeFlowchart}>{node.flowchart_name}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Mode selector */}
      <div className={styles.modeRow}>
        <div className={styles.modeSelector}>
          {modes.map(m => (
            <button
              key={m.value}
              className={`${styles.modeBtn} ${mode === m.value ? styles.modeBtnActive : ''}`}
              onClick={() => setMode(m.value)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Prompt */}
      <div className={styles.promptArea}>
        <textarea
          ref={promptRef}
          className={styles.promptInput}
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholders[mode]}
          rows={3}
        />
        <button className={styles.sendBtn} onClick={handleSend} disabled={loading || !prompt.trim()}>
          {loading ? 'Sending...' : 'Send'}
        </button>
      </div>

      {/* Error */}
      {error && <div className={styles.errorMsg}>{error}</div>}

      {/* Response */}
      {response && (
        <div className={styles.responseArea}>
          <ResponseRenderer
            content={response}
            onCopy={handleCopyCode}
            onApply={onApplyCode}
          />
          {tokenUsage && (
            <div className={styles.tokenUsage}>
              {tokenUsage.input.toLocaleString()} in / {tokenUsage.output.toLocaleString()} out
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Renders Claude's markdown response with "Copy" and "Apply" buttons on code blocks */
function ResponseRenderer({
  content,
  onCopy,
  onApply,
}: {
  content: string;
  onCopy: (code: string) => void;
  onApply?: (code: string) => void;
}) {
  // Split content into text and code blocks
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className={styles.response}>
      {parts.map((part, i) => {
        const codeMatch = part.match(/^```\w*\n([\s\S]*?)```$/);
        if (codeMatch) {
          const code = codeMatch[1];
          return (
            <div key={i} className={styles.codeBlockWrapper}>
              <pre className={styles.codeBlock}><code>{code}</code></pre>
              <div className={styles.codeActions}>
                <button className={styles.codeActionBtn} onClick={() => onCopy(code)}>Copy</button>
                {onApply && (
                  <button
                    className={styles.codeActionBtn}
                    onClick={() => {
                      if (confirm('Replace current file content with this code?')) {
                        onApply(code);
                      }
                    }}
                  >
                    Apply to editor
                  </button>
                )}
              </div>
            </div>
          );
        }
        if (part.trim()) {
          return <MarkdownRenderer key={i} content={part} />;
        }
        return null;
      })}
    </div>
  );
}

export default ClaudePanel;
