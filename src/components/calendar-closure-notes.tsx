import { CalendarOff } from "lucide-react";
import { closedDateInfo, closureRangeLabel, groupClosureDates } from "@/lib/calendar-options";

export function CalendarClosureNotes({
  days,
  after,
  serviceIds,
}: {
  days: { iso: string; selectable: boolean }[];
  after?: string | undefined;
  serviceIds?: string[];
}) {
  // Only upcoming closures: never before today (salon time), and only after the chosen day.
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const closed = days
    .filter((d) => !d.selectable && d.iso >= today && (!after || d.iso > after))
    .map((d) => ({ ...d, info: closedDateInfo(d.iso, serviceIds) }));
  const weekly = [
    ...new Set(closed.filter((d) => d.info?.label === "Closed").map((d) => d.info?.reason)),
  ];
  const holidays = groupClosureDates(
    closed.flatMap((d) =>
      d.info?.label === "Holiday" ? [{ iso: d.iso, reason: d.info.reason }] : [],
    ),
  );
  // a stylist-only service (Kiran's Signature): the days that stylist is away
  const away = groupClosureDates(
    closed.flatMap((d) =>
      d.info?.label === "Away" ? [{ iso: d.iso, reason: d.info.reason }] : [],
    ),
  );
  if (!weekly.length && !holidays.length && !away.length) return null;
  return (
    <div
      className="mt-4 flex flex-wrap items-start gap-x-6 gap-y-3 border-y border-hairline py-3 text-xs leading-relaxed text-muted-foreground"
      aria-label="Calendar closures"
    >
      {weekly.map((reason) => (
        <p key={reason} className="flex min-w-0 items-center gap-2">
          <CalendarOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{reason}</span>
        </p>
      ))}
      {holidays.map((range) => (
        <p key={range.start} className="flex min-w-0 items-start gap-2">
          <CalendarOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-bronze" aria-hidden="true" />
          <span className="min-w-0">
            <span className="font-medium text-foreground">
              {closureRangeLabel(range)} · Holiday closed
            </span>
            <span className="block">{range.reason}</span>
          </span>
        </p>
      ))}
      {away.map((range) => (
        <p key={"away" + range.start} className="flex min-w-0 items-center gap-2">
          <CalendarOff className="h-3.5 w-3.5 shrink-0 text-bronze" aria-hidden="true" />
          <span>
            <span className="font-medium text-foreground">{closureRangeLabel(range)}</span> ·{" "}
            {range.reason}
          </span>
        </p>
      ))}
    </div>
  );
}
