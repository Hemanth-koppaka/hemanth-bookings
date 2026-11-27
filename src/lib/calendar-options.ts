import { closureOn, EXCEPTIONS, fromISO, isClosed, SERVICE_RULES } from "./salon";
import { onlyAwayOn } from "./service-rules";

/** The "only one stylist" rule among these services (Kiran's Signature → Kiran). */
export function onlyRuleFor(serviceIds: string[] = []) {
  for (const id of serviceIds) if (SERVICE_RULES[id]?.only) return SERVICE_RULES[id]!;
  return null;
}

/** That stylist is away on this date, so these services can't be booked then. */
export function stylistAwayOn(iso: string, serviceIds: string[] = []) {
  return onlyAwayOn(onlyRuleFor(serviceIds), iso);
}

export function closedDateInfo(
  iso: string,
  serviceIds: string[] = [],
): { label: string; reason: string } | null {
  if (!isClosed(iso) && stylistAwayOn(iso, serviceIds)) {
    const name = onlyRuleFor(serviceIds)!.preferredName;
    return { label: "Away", reason: `${name} is away` };
  }
  if (!isClosed(iso)) return null;
  const closure = closureOn(iso);
  const exception = EXCEPTIONS[iso];
  if (closure || exception?.closed) {
    return { label: "Holiday", reason: closure?.reason || exception?.note || "Holiday closure" };
  }
  return {
    label: "Closed",
    reason: `Weekly closure · ${fromISO(iso).toLocaleDateString("en-GB", { weekday: "long" })}`,
  };
}

export function nearbyOpenDates(days: { iso: string; selectable: boolean }[], selected: string) {
  const distance = (iso: string) => Math.abs(Date.parse(iso) - Date.parse(selected));
  return days
    .filter((d) => d.selectable && d.iso !== selected)
    .sort((a, b) => distance(a.iso) - distance(b.iso) || a.iso.localeCompare(b.iso));
}

export type ClosureRange = { start: string; end: string; reason: string };

/** Merge only adjacent calendar dates with the same closure reason. */
export function groupClosureDates(dates: { iso: string; reason: string }[]): ClosureRange[] {
  const ranges: ClosureRange[] = [];
  for (const date of [...dates].sort((a, b) => a.iso.localeCompare(b.iso))) {
    const previous = ranges.at(-1);
    if (
      previous &&
      previous.reason === date.reason &&
      Date.parse(date.iso) - Date.parse(previous.end) === 86400000
    ) {
      previous.end = date.iso;
    } else {
      ranges.push({ start: date.iso, end: date.iso, reason: date.reason });
    }
  }
  return ranges;
}

export function closureRangeLabel({ start, end }: ClosureRange) {
  const first = fromISO(start);
  const last = fromISO(end);
  const format = (date: Date) =>
    date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      ...(first.getFullYear() !== last.getFullYear() ? { year: "numeric" as const } : {}),
    });
  if (start === end) return format(first);
  if (first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear())
    return `${first.getDate()}–${format(last)}`;
  return `${format(first)} – ${format(last)}`;
}
/**
 * A short line for a service only one stylist performs, when that stylist is
 * away soon (within 3 weeks) or not taking bookings: "Kiran away 1–4 Dec".
 */
export function stylistAwayNote(serviceId: string, today = new Date()): string | null {
  const rule = onlyRuleFor([serviceId]);
  if (!rule) return null;
  if (rule.off) return `Not available right now · only with ${rule.preferredName}`;
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const from = iso(today);
  const until = iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 21));
  const next = (rule.away ?? []).find((a) => a.end >= from && a.start <= until);
  if (!next) return null;
  const span = closureRangeLabel({
    start: next.start < from ? from : next.start,
    end: next.end,
    reason: "",
  });
  return `${rule.preferredName} away ${span}`;
}

/**
 * Home-page line while a stylist-only service's stylist (Kiran) is away now or
 * within the next week: "Kiran is away · back on Mon 30 Nov".
 */
export function stylistAwayBanner(today = new Date()): string | null {
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const from = iso(today);
  const week = iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7));
  const seen = new Set<string>();
  for (const rule of Object.values(SERVICE_RULES)) {
    if (!rule.only || rule.off || seen.has(rule.preferred)) continue;
    seen.add(rule.preferred);
    // join back-to-back leave so "back on" is the real return day
    const spans = [...(rule.away ?? [])].sort((a, b) => a.start.localeCompare(b.start));
    const next = spans.find((a) => a.end >= from && a.start <= week);
    if (!next) continue;
    let end = next.end;
    for (const a of spans) {
      const after = fromISO(end);
      after.setDate(after.getDate() + 1);
      if (a.start <= iso(after) && a.end > end) end = a.end;
    }
    const back = fromISO(end);
    back.setDate(back.getDate() + 1);
    const nice = (d: Date) =>
      d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
    return next.start <= from
      ? `${rule.preferredName} is away · back on ${nice(back)}`
      : `${rule.preferredName} is away ${closureRangeLabel({ start: next.start, end, reason: "" })} · back on ${nice(back)}`;
  }
  return null;
}

/** The first open day after `iso` when the "only" stylist for these services is back (null if not within 90 days). */
export function stylistBackOn(iso: string, serviceIds: string[] = []): string | null {
  const rule = onlyRuleFor(serviceIds);
  if (!rule || rule.off) return null;
  const d = fromISO(iso);
  for (let i = 1; i <= 90; i++) {
    d.setDate(d.getDate() + 1);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!isClosed(day) && !onlyAwayOn(rule, day)) return day;
  }
  return null;
}
