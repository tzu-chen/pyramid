import { Router, Request, Response } from 'express';
import db from '../db.js';
import { callClaude } from '../services/claude.js';
import { getSystemPrompt, type ClaudeMode } from '../services/claude-prompts.js';

const router = Router();

const VALID_MODES: ClaudeMode[] = ['error_diagnosis', 'formalization_help', 'implementation_help', 'general'];

// POST /api/sessions/:id/claude/ask
router.post('/:id/claude/ask', async (req: Request, res: Response) => {
  try {
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

    // Read API key
    const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get('claude_api_key') as { value: string } | undefined;
    if (!setting || !setting.value) {
      res.status(400).json({ error: 'Claude API key not configured. Set it in Settings.' });
      return;
    }

    // Read session for context
    const session = db.prepare('SELECT session_type, language FROM sessions WHERE id = ?').get(req.params.id) as {
      session_type: string;
      language: string;
    } | undefined;

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Build system prompt
    const claudeMode = (mode as ClaudeMode) || 'general';
    const systemPrompt = getSystemPrompt(claudeMode, session.session_type);

    // Assemble user message from context blocks + prompt
    let userMessage = '';
    if (context && Array.isArray(context)) {
      for (const block of context) {
        if (block.label && block.content) {
          userMessage += `## ${block.label}\n\n${block.content}\n\n`;
        }
      }
    }
    userMessage += prompt;

    const result = await callClaude(
      {
        messages: [{ role: 'user', content: userMessage }],
        system: systemPrompt,
      },
      setting.value
    );

    res.json({
      response: result.content,
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
    });
  } catch (err) {
    const message = (err as Error).message;
    // Pass through descriptive Claude errors as 502
    if (message.includes('API key') || message.includes('Rate limited')) {
      res.status(502).json({ error: message });
    } else {
      res.status(500).json({ error: message });
    }
  }
});

export default router;
