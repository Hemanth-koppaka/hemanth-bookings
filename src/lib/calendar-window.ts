/** Existing appointments remain inspectable even when the studio is closed. */
export function calendarWindow(
  plan: { closed: boolean; open: number; close: number },
  bookings: { time: number; end: number }[],
) {
  if (plan.closed && !bookings.length) return null;
  const start = Math.min(plan.open, ...bookings.map((b) => Math.floor(b.time / 60) * 60));
  const end = Math.max(plan.close + 30, ...bookings.map((b) => Math.ceil(b.end / 60) * 60));
  return { start, end: Math.max(start + 60, end) };
}
