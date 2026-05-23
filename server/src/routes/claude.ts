import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { callClaude, DEFAULT_CLAUDE_MODEL } from '../services/claude.js';
import { getSystemPrompt, type ClaudeMode } from '../services/claude-prompts.js';

const router = Router();

const VALID_MODES: ClaudeMode[] = ['error_diagnosis', 'formalization_help', 'implementation_help', 'general'];

interface ClaudeMessageRow {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  display_prompt: string | null;
  mode: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
}

function loadHistory(sessionId: string): ClaudeMessageRow[] {
  return db.prepare(
    `SELECT id, session_id, role, content, display_prompt, mode, input_tokens, output_tokens, created_at
     FROM claude_messages WHERE session_id = ? ORDER BY created_at ASC, id ASC`
  ).all(sessionId) as ClaudeMessageRow[];
}

// GET /api/sessions/:id/claude/history
router.get('/:id/claude/history', (req: Request, res: Response) => {
  try {
    const sessionId = req.params.id as string;
    const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({ messages: loadHistory(sessionId) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// DELETE /api/sessions/:id/claude/history
router.delete('/:id/claude/history', (req: Request, res: Response) => {
  try {
    const sessionId = req.params.id as string;
    const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    db.prepare('DELETE FROM claude_messages WHERE session_id = ?').run(sessionId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/sessions/:id/claude/ask
router.post('/:id/claude/ask', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.id as string;
    const { prompt, context, mode } = req.body as {
      prompt?: string;
      context?: Array<{ label: string; content: string }>;
      mode?: string;
    };

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      res.status(400).json({ error: 'Prompt is required' });
      return;
    }

    if (mode && !VALID_MODES.includes(mode as ClaudeMode)) {
      res.status(400).json({ error: `Invalid mode. Must be one of: ${VALID_MODES.join(', ')}` });
      return;
    }

    const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get('claude_api_key') as { value: string } | undefined;
    if (!setting || !setting.value) {
      res.status(400).json({ error: 'Claude API key not configured. Set it in Settings.' });
      return;
    }

    const session = db.prepare('SELECT session_type, language FROM sessions WHERE id = ?').get(sessionId) as {
      session_type: string;
      language: string;
    } | undefined;

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const claudeMode = (mode as ClaudeMode) || 'general';
    const systemPrompt = getSystemPrompt(claudeMode, session.session_type);

    // Assemble the new user turn: context blocks + typed prompt.
    let userContent = '';
    if (context && Array.isArray(context)) {
      for (const block of context) {
        if (block.label && block.content) {
          userContent += `## ${block.label}\n\n${block.content}\n\n`;
        }
      }
    }
    const trimmedPrompt = prompt.trim();
    userContent += trimmedPrompt;

    // Load prior turns and append the new user turn for the API call.
    const priorHistory = loadHistory(sessionId);
    const messages = priorHistory
      .map((m) => ({ role: m.role, content: m.content }))
      .concat([{ role: 'user' as const, content: userContent }]);

    const modelSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('claude_model') as { value: string } | undefined;
    const model = modelSetting?.value?.trim() || DEFAULT_CLAUDE_MODEL;

    const result = await callClaude(
      {
        messages,
        system: systemPrompt,
        model,
      },
      setting.value
    );

    // Persist the user turn and assistant turn atomically.
    const now = new Date().toISOString();
    const userRow: ClaudeMessageRow = {
      id: uuidv4(),
      session_id: sessionId,
      role: 'user',
      content: userContent,
      display_prompt: trimmedPrompt,
      mode: claudeMode,
      input_tokens: null,
      output_tokens: null,
      created_at: now,
    };
    // Use a slightly later timestamp for the assistant turn so ordering is stable
    // even when both rows share the same millisecond.
    const assistantRow: ClaudeMessageRow = {
      id: uuidv4(),
      session_id: sessionId,
      role: 'assistant',
      content: result.content,
      display_prompt: null,
      mode: claudeMode,
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
      created_at: new Date(Date.now() + 1).toISOString(),
    };

    const insert = db.prepare(
      `INSERT INTO claude_messages (id, session_id, role, content, display_prompt, mode, input_tokens, output_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    db.transaction(() => {
      insert.run(userRow.id, userRow.session_id, userRow.role, userRow.content, userRow.display_prompt, userRow.mode, userRow.input_tokens, userRow.output_tokens, userRow.created_at);
      insert.run(assistantRow.id, assistantRow.session_id, assistantRow.role, assistantRow.content, assistantRow.display_prompt, assistantRow.mode, assistantRow.input_tokens, assistantRow.output_tokens, assistantRow.created_at);
    })();

    res.json({
      response: result.content,
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
      user_message: userRow,
      assistant_message: assistantRow,
    });
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes('API key') || message.includes('Rate limited')) {
      res.status(502).json({ error: message });
    } else {
      res.status(500).json({ error: message });
    }
  }
});

export default router;
