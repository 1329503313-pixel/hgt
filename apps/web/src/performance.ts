type MetricName = "navigation" | "lcp" | "long-task" | "interaction";

function report(name: MetricName, value: number) {
  if (!Number.isFinite(value) || value < 0) return;
  const route = window.location.pathname.replace(/[A-Za-z0-9_-]{12,}/g, ":id").slice(0, 160);
  const payload = JSON.stringify({ name, value: Math.round(value), route });
  navigator.sendBeacon?.("/api/telemetry/performance", new Blob([payload], { type: "application/json" }));
}

export function setupPerformanceMonitoring() {
  if (typeof PerformanceObserver === "undefined") return;
  if (import.meta.env.PROD && Math.random() > 0.2) return;

  let latestLcp = 0;
  let longestTask = 0;
  let longestInteraction = 0;
  try {
    const lcp = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) latestLcp = Math.max(latestLcp, entry.startTime);
    });
    lcp.observe({ type: "largest-contentful-paint", buffered: true });
    const tasks = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longestTask = Math.max(longestTask, entry.duration);
    });
    tasks.observe({ type: "longtask", buffered: true });
    const events = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longestInteraction = Math.max(longestInteraction, entry.duration);
    });
    events.observe({ type: "event", buffered: true, durationThreshold: 40 } as PerformanceObserverInit);
  } catch {
    // Older WebViews may not support every performance entry type.
  }

  window.addEventListener("load", () => {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (navigation) report("navigation", navigation.loadEventEnd || navigation.duration);
  }, { once: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    report("lcp", latestLcp);
    report("long-task", longestTask);
    report("interaction", longestInteraction);
  });
}
