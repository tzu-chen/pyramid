import { api } from './api';

export type ClaudeMode = 'error_diagnosis' | 'formalization_help' | 'implementation_help' | 'general';

export interface ContextBlock {
  label: string;
  content: string;
}

export interface ClaudeAskResponse {
  response: string;
  input_tokens: number;
  output_tokens: number;
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
