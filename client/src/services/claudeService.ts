import { api } from './api';

export type ClaudeMode = 'error_diagnosis' | 'formalization_help' | 'implementation_help' | 'general';

export interface ContextBlock {
  label: string;
  content: string;
}

export interface ClaudeMessage {
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

export interface ClaudeAskResponse {
  response: string;
  input_tokens: number;
  output_tokens: number;
  user_message: ClaudeMessage;
  assistant_message: ClaudeMessage;
}

export interface ScribeFlowchart {
  id: string;
  name: string;
}

export interface ScribeNode {
  node_key: string;
  title: string;
  refs?: string;
  topics?: string;
  flowchart_id?: string;
  flowchart_name?: string;
}

export interface ScribeBook {
  id: string;
  filename: string;
  subject?: string;
}

export const claudeService = {
  async ask(
    sessionId: string,
    prompt: string,
    context: ContextBlock[],
    mode: ClaudeMode
  ): Promise<ClaudeAskResponse> {
    return api.post<ClaudeAskResponse>(`/sessions/${sessionId}/claude/ask`, {
      prompt,
      context,
      mode,
    });
  },

  async getHistory(sessionId: string): Promise<ClaudeMessage[]> {
    const res = await api.get<{ messages: ClaudeMessage[] }>(`/sessions/${sessionId}/claude/history`);
    return res.messages;
  },

  async clearHistory(sessionId: string): Promise<void> {
    await api.delete(`/sessions/${sessionId}/claude/history`);
  },
};

export const scribeService = {
  async listFlowcharts(): Promise<ScribeFlowchart[]> {
    return api.get<ScribeFlowchart[]>('/scribe/flowcharts');
  },

  async searchNodes(title: string): Promise<ScribeNode[]> {
    return api.get<ScribeNode[]>(`/scribe/nodes/search?title=${encodeURIComponent(title)}`);
  },

  async getNode(flowchartId: string, nodeKey: string): Promise<ScribeNode> {
    return api.get<ScribeNode>(`/scribe/nodes/${flowchartId}/${nodeKey}`);
  },

  async searchBooks(search: string): Promise<ScribeBook[]> {
    return api.get<ScribeBook[]>(`/scribe/books?search=${encodeURIComponent(search)}`);
  },
};

export const settingsService = {
  async get(key: string): Promise<{ key: string; value: string } | null> {
    try {
      return await api.get<{ key: string; value: string }>(`/settings/${key}`);
    } catch {
      return null;
    }
  },

  async set(key: string, value: string): Promise<void> {
    await api.put(`/settings/${key}`, { value });
  },
};
