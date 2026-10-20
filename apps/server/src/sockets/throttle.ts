// Coalesces bursts: however often `request()` is called, `fn` runs at most once per `ms`,
// always after the latest request (so the last change is never lost).
export function throttle(fn: () => void, ms: number): () => void {
  let timer: NodeJS.Timeout | null = null;
  let lastRun = -Infinity;
  return () => {
    if (timer) return; // a run is already scheduled and will see this change
    timer = setTimeout(
      () => {
        timer = null;
        lastRun = Date.now();
        fn();
      },
      Math.max(0, lastRun + ms - Date.now()),
    );
    timer.unref(); // never keeps the process (or a test) alive
  };
}
