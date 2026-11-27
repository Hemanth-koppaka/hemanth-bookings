export type CalendarOverlay = { start: number; end: number; label: string; kind: "break" | "block" };

/** Partition visible unavailability so each time slice has exactly one label. */
export function calendarOverlays(ranges: CalendarOverlay[], open: number, close: number): CalendarOverlay[] {
  const clipped = ranges.map((r) => ({ ...r, start: Math.max(open, r.start), end: Math.min(close, r.end) })).filter((r) => r.end > r.start);
  const edges = [...new Set(clipped.flatMap((r) => [r.start, r.end]))].sort((a, b) => a - b);
  const result: CalendarOverlay[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const start = edges[i];
    const end = edges[i + 1];
    if (start === undefined || end === undefined) continue;
    const active = clipped.filter((r) => r.start < end && r.end > start);
    if (!active.length) continue;
    const label = [...new Set(active.map((r) => r.label.trim() || "Unavailable"))].join(" · ");
    const kind = active.some((r) => r.kind === "block") ? "block" : "break";
    const last = result[result.length - 1];
    if (last && last.end === start && last.label === label && last.kind === kind) last.end = end;
    else result.push({ start, end, label, kind });
  }
  return result;
}