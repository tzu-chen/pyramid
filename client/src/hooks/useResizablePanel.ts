import { useState, useRef, useCallback, useEffect } from 'react';

interface UseResizablePanelOptions {
  storageKey: string;
  defaultRatio: number;
  minRatio: number;
  maxRatio: number;
  axis?: 'x' | 'y';
}

export function useResizablePanel({
  storageKey,
  defaultRatio,
  minRatio,
  maxRatio,
  axis = 'x',
}: UseResizablePanelOptions) {
  const [ratio, setRatio] = useState<number>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null) {
        const parsed = parseFloat(stored);
        if (!isNaN(parsed) && parsed >= minRatio && parsed <= maxRatio) {
          return parsed;
        }
      }
    } catch { /* ignore */ }
    return defaultRatio;
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const onDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    const cursor = axis === 'y' ? 'row-resize' : 'col-resize';
    document.body.style.cursor = cursor;
    document.body.style.userSelect = 'none';

    const getClient = (ev: MouseEvent | TouchEvent): number => {
      if ('touches' in ev) {
        return axis === 'y' ? ev.touches[0].clientY : ev.touches[0].clientX;
      }
      return axis === 'y' ? ev.clientY : ev.clientX;
    };

    const onMove = (ev: MouseEvent | TouchEvent) => {
      if (!draggingRef.current || !containerRef.current) return;
      ev.preventDefault();
      const rect = containerRef.current.getBoundingClientRect();
      const offset = getClient(ev) - (axis === 'y' ? rect.top : rect.left);
      const total = axis === 'y' ? rect.height : rect.width;
      if (total <= 0) return;
      const newRatio = Math.min(maxRatio, Math.max(minRatio, offset / total));
      setRatio(newRatio);
    };

    const onEnd = () => {
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);

      // Persist on end
      setRatio(current => {
        try { localStorage.setItem(storageKey, String(current)); } catch { /* */ }
        return current;
      });
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
  }, [storageKey, minRatio, maxRatio, axis]);

  // Cleanup on unmount in case drag is in progress
  useEffect(() => {
    return () => {
      if (draggingRef.current) {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
  }, []);

  return { ratio, onDragStart, containerRef };
}
