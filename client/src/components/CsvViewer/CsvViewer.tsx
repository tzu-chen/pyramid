import { useEffect, useMemo, useState } from 'react';
import { fileService } from '../../services/fileService';
import styles from './CsvViewer.module.css';

interface CsvViewerProps {
  sessionId: string;
  fileId: string;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += ch;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function CsvViewer({ sessionId, fileId }: CsvViewerProps) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setError(null);
    fileService.getContent(sessionId, fileId)
      .then(c => { if (!cancelled) setContent(c); })
      .catch(() => { if (!cancelled) setError('Failed to load file'); });
    return () => { cancelled = true; };
  }, [sessionId, fileId]);

  const rows = useMemo(() => content == null ? [] : parseCsv(content), [content]);

  if (error) return <div className={styles.message}>{error}</div>;
  if (content == null) return <div className={styles.message}>Loading...</div>;
  if (rows.length === 0) return <div className={styles.message}>Empty file</div>;

  const header = rows[0];
  const body = rows.slice(1);
  const colCount = Math.max(...rows.map(r => r.length));

  return (
    <div className={styles.container}>
      <div className={styles.meta}>
        {body.length} row{body.length === 1 ? '' : 's'} × {colCount} column{colCount === 1 ? '' : 's'}
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.rowNum}>#</th>
              {Array.from({ length: colCount }).map((_, i) => (
                <th key={i}>{header[i] ?? ''}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((r, ri) => (
              <tr key={ri}>
                <td className={styles.rowNum}>{ri + 1}</td>
                {Array.from({ length: colCount }).map((_, ci) => (
                  <td key={ci}>{r[ci] ?? ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default CsvViewer;
