/** Expand working shifts to include edited salon hours; never remove a staff day off. */
export function expandedWorkingWindow(
  shift: { working: boolean; start: number; end: number },
  salon: { open: boolean; start: number; end: number },
): { start: number; end: number } | null {
  if (!shift.working || !salon.open) return null;
  const start = Math.min(shift.start, salon.start);
  const end = Math.max(shift.end, salon.end);
  return start === shift.start && end === shift.end ? null : { start, end };
}