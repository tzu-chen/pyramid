import path from 'path';
import fs from 'fs';

export function validateFilePath(filename: string): { valid: boolean; normalized?: string; error?: string } {
  if (!filename || typeof filename !== 'string') {
    return { valid: false, error: 'Filename is required' };
  }

  if (filename.includes('\0')) {
    return { valid: false, error: 'Filename contains null bytes' };
  }

  // Normalize separators
  let normalized = filename.replace(/\\/g, '/');

  // Trim leading/trailing slashes
  normalized = normalized.replace(/^\/+|\/+$/g, '');

  if (!normalized) {
    return { valid: false, error: 'Filename is empty' };
  }

  if (normalized.length > 255) {
    return { valid: false, error: 'Filename exceeds 255 characters' };
  }

  // Reject absolute paths
  if (path.isAbsolute(filename)) {
    return { valid: false, error: 'Absolute paths are not allowed' };
  }

  // Check each segment
  const segments = normalized.split('/');
  if (segments.length > 10) {
    return { valid: false, error: 'Path exceeds maximum depth of 10 levels' };
  }

  for (const segment of segments) {
    if (!segment) {
      return { valid: false, error: 'Path contains empty segments' };
    }
    if (segment === '.' || segment === '..') {
      return { valid: false, error: 'Path traversal is not allowed' };
    }
  }

  return { valid: true, normalized };
}

/**
 * Remove empty parent directories between filePath's parent and sessionRoot.
 */
export function cleanEmptyParentDirs(filePath: string, sessionRoot: string): void {
  let dir = path.dirname(filePath);
  const resolvedRoot = path.resolve(sessionRoot);

  while (path.resolve(dir) !== resolvedRoot && path.resolve(dir).startsWith(resolvedRoot)) {
    try {
      const entries = fs.readdirSync(dir);
      if (entries.length === 0) {
        fs.rmdirSync(dir);
        dir = path.dirname(dir);
      } else {
        break;
      }
    } catch {
      break;
    }
  }
}
