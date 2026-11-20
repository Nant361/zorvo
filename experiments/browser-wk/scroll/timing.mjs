export function frameSummary(intervals) {
  if (!Array.isArray(intervals) || intervals.length === 0 || intervals.some(value => !Number.isFinite(value) || value <= 0)) {
    throw new Error("Frame intervals must be a nonempty list of positive finite numbers.");
  }
  const sorted = [...intervals].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const medianMs = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  const thresholdMs = 1.5 * medianMs;
  const longIntervals = intervals.filter(interval => interval > thresholdMs).length;
  return {
    medianMs, longIntervalThresholdMs: thresholdMs,
    intervalsOver1_5Median: longIntervals,
    longIntervalPercent: 100 * longIntervals / intervals.length,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    p99Ms: sorted[Math.ceil(sorted.length * 0.99) - 1],
  };
}
