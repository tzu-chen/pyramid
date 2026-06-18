// Extract the missing top-level module name from a Python error blob (run
// stderr or a notebook cell error's evalue/traceback). Returns the
// distribution candidate (foo.bar → foo); null if no ModuleNotFoundError.
// Note: the import name isn't always the PyPI name (e.g. cv2 → opencv-python);
// callers install the literal name and let the user correct it in the panel.
export function parseMissingModule(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/No module named ['"]?([A-Za-z0-9_][A-Za-z0-9_.]*)['"]?/);
  if (!m) return null;
  return m[1].split('.')[0];
}
