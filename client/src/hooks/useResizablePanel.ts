import { useState, useRef, useCallback, useEffect } from 'react';

interface UseResizablePanelOptions {
  storageKey: string;
  defaultRatio: number;
  minRatio: number;
  maxRatio: number;
}

export function useResizablePanel({
  storageKey,
  defaultRatio,
  minRatio,
  maxRatio,
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
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const getClientX = (ev: MouseEvent | TouchEvent): number => {
      if ('touches' in ev) return ev.touches[0].clientX;
      return ev.clientX;
    };

    const onMove = (ev: MouseEvent | TouchEvent) => {
      if (!draggingRef.current || !containerRef.current) return;
      ev.preventDefault();
      const rect = containerRef.current.getBoundingClientRect();
      const x = getClientX(ev) - rect.left;
      const newRatio = Math.min(maxRatio, Math.max(minRatio, x / rect.width));
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
  }, [storageKey, minRatio, maxRatio]);

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
