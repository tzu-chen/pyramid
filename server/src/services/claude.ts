interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ClaudeRequest {
  messages: ClaudeMessage[];
  system?: string;
  max_tokens?: number;
}

interface ClaudeResponse {
  content: string;
  input_tokens: number;
  output_tokens: number;
}

export async function callClaude(request: ClaudeRequest, apiKey: string): Promise<ClaudeResponse> {
  const body = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: request.max_tokens ?? 4096,
    system: request.system,
    messages: request.messages,
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    if (res.status === 401) {
      throw new Error('Invalid API key. Check your Claude API key in Settings.');
    }
    if (res.status === 429) {
      throw new Error('Rate limited. Please wait a moment before trying again.');
    }
    throw new Error(`Claude API error (${res.status}): ${errorBody}`);
  }

  const data = await res.json() as {
    content: Array<{ type: string; text?: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  const textContent = data.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  return {
    content: textContent,
    input_tokens: data.usage.input_tokens,
    output_tokens: data.usage.output_tokens,
  };
}
