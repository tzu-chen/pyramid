// Human-readable byte sizes (binary units). Returns '' for null/undefined so
// callers can render nothing when a metric is unavailable.
export function formatBytes(n: number | null | undefined): string {
  if (n == null) return '';
  const neg = n < 0;
  let v = Math.abs(n);
  let unit = 'B';
  if (v >= 1024 * 1024 * 1024) { v /= 1024 * 1024 * 1024; unit = 'GB'; }
  else if (v >= 1024 * 1024) { v /= 1024 * 1024; unit = 'MB'; }
  else if (v >= 1024) { v /= 1024; unit = 'KB'; }
  const s = unit === 'B' ? `${v} B` : `${v.toFixed(1)} ${unit}`;
  return neg ? `-${s}` : s;
}
