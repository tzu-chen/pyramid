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

export interface ScribeBook {
  id: string;
  filename: string;
  subject?: string;
}

// Raw attachment shape as returned by Scribe's /api/attachments (subset of fields we use).
interface ScribeAttachment {
  id: string;
  filename: string;
  subject?: string;
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

// Scribe's PDF library (attachments) are "books". There is no server-side
// search endpoint, so fetch the full list and filter by filename/subject here.
export async function searchScribeBooks(query: string): Promise<ScribeBook[]> {
  const attachments = await scribeFetch<ScribeAttachment[]>('/api/attachments');
  if (!attachments) return [];
  const q = query.trim().toLowerCase();
  const matches = q
    ? attachments.filter(
        a =>
          a.filename?.toLowerCase().includes(q) ||
          (a.subject?.toLowerCase().includes(q) ?? false)
      )
    : attachments;
  return matches.slice(0, 50).map(a => ({
    id: a.id,
    filename: a.filename,
    subject: a.subject,
  }));
}
