import fs from 'fs';

// Best-effort peak-RSS sampling for a child process via Linux /proc.
//
// `/proc/<pid>/status` exposes `VmHWM` — the kernel-maintained high-water mark
// of resident set size — so we don't have to catch the exact peak moment; we
// just need to read it at least once before the process dies. We still poll on
// an interval (and read once more on stop) because VmHWM vanishes with the
// process, so a final spike right before exit could otherwise be missed.
//
// Non-Linux platforms have no /proc; sampling returns null there and callers
// persist null (the column is nullable). Values are in bytes.

const SAMPLE_INTERVAL_MS = 50;

export interface MemorySampler {
  // Stops sampling and returns the peak RSS in bytes, or null if no sample was
  // ever obtained (unsupported platform, or process never readable).
  stop(): number | null;
}

const NOOP_SAMPLER: MemorySampler = { stop: () => null };

export function sampleProcessMemory(pid: number | undefined): MemorySampler {
  if (process.platform !== 'linux' || !pid) return NOOP_SAMPLER;

  const statusPath = `/proc/${pid}/status`;
  let peakKb = 0;
  let sampled = false;

  const readOnce = () => {
    try {
      const txt = fs.readFileSync(statusPath, 'utf8');
      const m = /VmHWM:\s+(\d+)\s+kB/.exec(txt);
      if (m) {
        sampled = true;
        const kb = parseInt(m[1], 10);
        if (kb > peakKb) peakKb = kb;
      }
    } catch {
      // Process gone, not yet started, or status unreadable — ignore.
    }
  };

  readOnce();
  const timer = setInterval(readOnce, SAMPLE_INTERVAL_MS);
  // Don't let the sampler keep the event loop alive on its own.
  timer.unref?.();

  return {
    stop() {
      readOnce();
      clearInterval(timer);
      // VmHWM is reported in KiB (the "kB" label notwithstanding).
      return sampled ? peakKb * 1024 : null;
    },
  };
}
