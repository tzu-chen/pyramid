const SCRIBE_BASE = 'http://localhost:3003';
const TIMEOUT_MS = 3000;

export interface ScribeNodeContent {
  node_key: string;
  title: string;
  refs?: string;
  topics?: string;
  flowchart_id?: string;
  flowchart_name?: string;
}

export interface ScribeFlowchart {
  id: string;
  name: string;
  [key: string]: unknown;
}

async function scribeFetch<T>(path: string): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(`${SCRIBE_BASE}${path}`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    // Connection refused, timeout, or other network error — Scribe not running
    return null;
  }
}

export async function fetchScribeNode(
  flowchartId: string,
  nodeKey: string
): Promise<ScribeNodeContent | null> {
  return scribeFetch<ScribeNodeContent>(`/api/flowcharts/nodes/${flowchartId}/${nodeKey}`);
}

export async function searchScribeNodes(
  titleQuery: string
): Promise<ScribeNodeContent[]> {
  const result = await scribeFetch<ScribeNodeContent[]>(
    `/api/flowcharts/nodes/search?title=${encodeURIComponent(titleQuery)}`
  );
  return result ?? [];
}

export async function listScribeFlowcharts(): Promise<ScribeFlowchart[]> {
  const result = await scribeFetch<ScribeFlowchart[]>('/api/flowcharts');
  return result ?? [];
}
