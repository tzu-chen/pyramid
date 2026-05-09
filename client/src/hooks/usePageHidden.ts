import { useEffect, useState } from 'react';

const DEFAULT_DELAY_MS = 60_000;

/**
 * Flips true once the page has been hidden continuously for `delayMs`.
 * Used to suspend long-lived WebSocket connections (LSPs, kernels, PTYs)
 * while the user is on another browser tab so server-side processes can be
 * reaped by their idle timers.
 */
export function usePageHidden(delayMs: number = DEFAULT_DELAY_MS): boolean {
  const [hidden, setHidden] = useState<boolean>(() =>
    typeof document !== 'undefined' && document.hidden
  );

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const onChange = () => {
      if (document.hidden) {
        if (!timer) {
          timer = setTimeout(() => {
            timer = null;
            setHidden(true);
          }, delayMs);
        }
      } else {
        if (timer) { clearTimeout(timer); timer = null; }
        setHidden(false);
      }
    };

    document.addEventListener('visibilitychange', onChange);
    onChange();

    return () => {
      document.removeEventListener('visibilitychange', onChange);
      if (timer) clearTimeout(timer);
    };
  }, [delayMs]);

  return hidden;
}
