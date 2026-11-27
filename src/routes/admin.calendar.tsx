import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { toast } from "sonner";
import { Ban, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { AdminShell, TinyButton } from "@/components/admin";
import {
  BlockTimeDialog,
  BookingDrawer,
  LoadState,
  NewBookingDialog,
  dateLabel,
  salonToday,
  useAdminData,
} from "@/components/admin-ops";
import { useAdmin, type ApptStatus } from "@/lib/admin-store";
import { adminDay, adminRange, type AdminBooking } from "@/lib/admin-data.functions";
import { StaffAvatar } from "@/components/staff-avatar";
import { adminUpsertBooking } from "@/lib/salon.functions";
import { fromISO, hoursFor, isClosed, minuteLabel, toISO } from "@/lib/salon";
import { calendarWindow } from "@/lib/calendar-window";
import { cn } from "@/lib/utils";
import { calendarOverlays } from "@/lib/calendar-overlays";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/admin/calendar")({
  // the assistant's "View in Calendar" opens a given day: ?date=2026-11-14
  validateSearch: (s: Record<string, unknown>): { date?: string } =>
    typeof s["date"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s["date"])
      ? { date: s["date"] }
      : {},
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: "Calendar — Lumen Studio" },
      { name: "description", content: "Day, week and month view of the salon's chair." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Calendar — Lumen Studio" },
      { property: "og:description", content: "Day, week and month view." },
    ],
  }),
  component: CalendarScreen,
});

type View = "day" | "week" | "month";

/** One colour per stylist column (initials and the booking's edge). */
const STYLIST_COLOURS = ["#6250d6", "#1baf7a", "#00B386", "#2a78d6", "#e87ba4", "#24CFA4"];

const addDays = (iso: string, n: number) => {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
};
const weekStart = (iso: string) => addDays(iso, -((fromISO(iso).getDay() + 6) % 7));
const monthStart = (iso: string) => `${iso.slice(0, 8)}01`;

const BLOCK_TONE: Record<ApptStatus, string> = {
  pending: "border-amber-500/60 bg-amber-50 text-amber-950",
  upcoming: "border-foreground/25 bg-background",
  arrived: "border-bronze/60 bg-champagne/30",
  "in-chair": "border-foreground bg-foreground text-background",
  completed: "border-emerald-700/30 bg-emerald-50 text-emerald-950",
  "no-show": "border-destructive/40 bg-destructive/[0.06] text-destructive",
  cancelled: "border-destructive/20 bg-background text-muted-foreground line-through",
};

function CalendarScreen() {
  const [view, setView] = useState<View>("day");
  const search = Route.useSearch();
  const [date, setDate] = useState(search.date ?? salonToday());
  // a new ?date= (e.g. from the assistant while already on this page) moves the calendar
  useEffect(() => {
    if (search.date) setDate(search.date);
  }, [search.date]);
  const [drawer, setDrawer] = useState<string | null>(null);
  const [newAt, setNewAt] = useState<{
    date: string;
    time: number | null;
    staffId?: string | undefined;
  } | null>(null);
  const [blockOpen, setBlockOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);

  const step = (dir: 1 | -1) => {
    if (view === "day") setDate(addDays(date, dir));
    else if (view === "week") setDate(addDays(date, dir * 7));
    else {
      const d = fromISO(date);
      d.setDate(1);
      d.setMonth(d.getMonth() + dir);
      setDate(toISO(d));
    }
  };

  const title =
    view === "day"
      ? dateLabel(date, { weekday: "long", day: "numeric", month: "long" })
      : view === "week"
        ? `${dateLabel(weekStart(date), { day: "numeric", month: "short" })} – ${dateLabel(addDays(weekStart(date), 6), { day: "numeric", month: "short" })}`
        : fromISO(date).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  return (
    <AdminShell title="Calendar" wide>
      <div className="mb-4 flex flex-wrap gap-2">
        <TinyButton tone="primary" onClick={() => setNewAt({ date, time: null })}>
          <Plus className="h-4 w-4" /> New booking
        </TinyButton>
        <TinyButton onClick={() => setBlockOpen(true)}>
          <Ban className="h-4 w-4" /> Block time
        </TinyButton>
      </div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <button
            aria-label="Previous"
            onClick={() => step(-1)}
            className="press grid h-9 w-9 place-items-center rounded-md border border-foreground/15"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            aria-label="Next"
            onClick={() => step(1)}
            className="press grid h-9 w-9 place-items-center rounded-md border border-foreground/15"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => setDate(salonToday())}
            className="press ml-1 h-9 rounded-md border border-foreground/15 px-3 text-[0.8rem]"
          >
            Today
          </button>
          <h2 className="mt-2 w-full font-display text-[1.5rem] leading-tight sm:ml-3 sm:mt-0 sm:w-auto">
            {title}
          </h2>
        </div>
        <div className="flex rounded-md border border-foreground/15 p-0.5">
          {(["day", "week", "month"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "rounded px-3.5 py-1.5 text-[0.8rem] capitalize",
                view === v ? "bg-foreground text-background" : "text-muted-foreground",
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {view === "day" ? (
        <DayView
          key={`${date}-${version}`}
          date={date}
          onOpen={setDrawer}
          onBook={(t, staffId) => setNewAt({ date, time: t, staffId })}
          onChanged={refresh}
        />
      ) : view === "week" ? (
        <WeekView
          key={`${weekStart(date)}-${version}`}
          from={weekStart(date)}
          onOpen={setDrawer}
          onDay={(d) => {
            setDate(d);
            setView("day");
          }}
        />
      ) : (
        <MonthView
          key={`${monthStart(date)}-${version}`}
          month={monthStart(date)}
          onDay={(d) => {
            setDate(d);
            setView("day");
          }}
        />
      )}

      <BookingDrawer reference={drawer} onClose={() => setDrawer(null)} onChanged={refresh} />
      <NewBookingDialog
        open={Boolean(newAt)}
        onOpenChange={(o) => !o && setNewAt(null)}
        initialDate={newAt?.date ?? date}
        initialTime={newAt?.time ?? null}
        initialStaffId={newAt?.staffId}
        onCreated={refresh}
      />
      <BlockTimeDialog
        open={blockOpen}
        onOpenChange={setBlockOpen}
        initialDate={date}
        onSaved={refresh}
      />
    </AdminShell>
  );
}

/* ── day: appointments fill their real duration; drag to move ── */

const PX_PER_MIN = 1.6;

function DayView({
  date,
  onOpen,
  onBook,
  onChanged,
}: {
  date: string;
  onOpen: (ref: string) => void;
  onBook: (time: number, staffId?: string) => void;
  onChanged: () => void;
}) {
  const { pin } = useAdmin();
  const { data, loading, error, reload } = useAdminData(
    (p) => adminDay({ data: { pin: p, date } }),
    [date],
  );
  const [drag, setDrag] = useState<{
    ref: string;
    dy: number;
    dx: number;
    target?: string | undefined;
  } | null>(null);
  const [pressing, setPressing] = useState<string | null>(null);
  const hold = useRef<{ x: number; y: number; timer: number; feedback?: number } | null>(null);
  const dragActive = useRef(false);
  useEffect(() => {
    // Once an appointment is picked up, finger movement moves it instead of scrolling.
    const stop = (ev: TouchEvent) => {
      if (dragActive.current) ev.preventDefault();
    };
    window.addEventListener("touchmove", stop, { passive: false });
    return () => window.removeEventListener("touchmove", stop);
  }, []);
  // a move: new time, and (dragged sideways) another stylist
  const [move, setMove] = useState<{
    b: AdminBooking;
    to: number;
    staffId?: string;
    staffName?: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const origin = useRef<{ y: number; x: number; moved: boolean } | null>(null);

  if (!data) return <LoadState loading={loading} error={error} onRetry={reload} />;
  const { plan, interval } = data;
  const visible = data.bookings.filter((b) => b.status !== "cancelled");
  const displayWindow = calendarWindow(plan, visible);
  if (!displayWindow)
    return (
      <p className="rounded-md border border-dashed border-foreground/15 px-6 py-16 text-center text-muted-foreground">
        The studio is closed on this day.
      </p>
    );

  const start = displayWindow.start;
  const end = displayWindow.end;
  const height = (end - start) * PX_PER_MIN;
  const y = (m: number) => (m - start) * PX_PER_MIN;
  const snap = (m: number) => Math.round(m / interval) * interval;
  const hours: number[] = [];
  for (let m = Math.ceil(start / 60) * 60; m <= end; m += 60) hours.push(m);
  const nowLine =
    data.now.iso === date && data.now.minute >= start && data.now.minute <= end
      ? data.now.minute
      : null;
  const movable = (b: AdminBooking) => ["pending", "upcoming"].includes(b.status);

  const onDown = (e: RPointerEvent, b: AdminBooking) => {
    if (!movable(b)) return;
    const el = e.currentTarget as HTMLElement;
    const id = e.pointerId;
    const begin = () => {
      try {
        el.setPointerCapture(id);
      } catch {
        /* pointer already gone */
      }
      origin.current = { y: e.clientY, x: e.clientX, moved: false };
      dragActive.current = true;
      if (e.pointerType !== "mouse") navigator.vibrate?.(15);
      setPressing(null);
      setDrag({ ref: b.reference, dy: 0, dx: 0, target: b.staffId ?? undefined });
    };
    if (e.pointerType === "mouse") return begin();
    // Touch: press and hold to pick up; a quick swipe just scrolls the calendar.
    // Only show the "pressing" feedback once the finger has rested a moment,
    // and only pick up after a deliberate long press.
    const ref = b.reference;
    const feedback = window.setTimeout(() => setPressing(ref), 180);
    hold.current = {
      x: e.clientX,
      y: e.clientY,
      timer: window.setTimeout(() => {
        window.clearTimeout(feedback);
        begin();
      }, 600),
      feedback,
    };
  };
  const cancelHold = () => {
    if (hold.current) {
      window.clearTimeout(hold.current.timer);
      if (hold.current.feedback) window.clearTimeout(hold.current.feedback);
    }
    hold.current = null;
    setPressing(null);
  };
  const onMove = (e: RPointerEvent) => {
    if (hold.current && !drag) {
      if (Math.abs(e.clientX - hold.current.x) > 6 || Math.abs(e.clientY - hold.current.y) > 6)
        cancelHold();
      return;
    }
    if (!origin.current || !drag) return;
    const dy = e.clientY - origin.current.y;
    const dx = e.clientX - origin.current.x;
    const zone = e.pointerType === "mouse" ? 4 : 12;
    if (!origin.current.moved && Math.abs(dy) < zone && Math.abs(dx) < zone) return;
    origin.current.moved = true;
    const card = e.currentTarget as HTMLElement;
    const over = document
      .elementsFromPoint(e.clientX, e.clientY)
      .filter((el) => !card.contains(el))
      .map((el) => (el as HTMLElement).closest?.("[data-col-staff]") as HTMLElement | null)
      .find(Boolean);
    setDrag({ ...drag, dy, dx, target: over?.dataset["colStaff"] ?? drag.target });
  };
  const onUp = (b: AdminBooking, e: RPointerEvent) => {
    cancelHold();
    dragActive.current = false;
    const o = origin.current;
    origin.current = null;
    const dy = drag?.dy ?? 0;
    setDrag(null);
    if (!o?.moved) return onOpen(b.reference);
    const to = Math.max(start, Math.min(end - b.minutes, snap(b.time + dy / PX_PER_MIN)));
    // dropped in another stylist's column?
    // (looking past the card being dragged, which still belongs to its old column)
    const card = e.currentTarget as HTMLElement;
    const col = document
      .elementsFromPoint(e.clientX, e.clientY)
      .filter((el) => !card.contains(el))
      .map((el) => (el as HTMLElement).closest?.("[data-col-staff]") as HTMLElement | null)
      .find(Boolean);
    const target = col?.dataset["colStaff"];
    const other = target && target !== b.staffId ? target : undefined;
    if (to === b.time && !other) return;
    const why = conflictAt(b, to, other ?? b.staffId ?? undefined);
    if (why) {
      toast.error("Can't move this appointment here", { description: why });
      return;
    }
    if (to !== b.time || other)
      setMove({
        b,
        to,
        ...(other ? { staffId: other, staffName: col?.dataset["colName"] ?? "" } : {}),
      });
  };

  const confirmMove = async () => {
    if (!move) return;
    setSaving(true);
    try {
      await adminUpsertBooking({
        data: {
          pin,
          reference: move.b.reference,
          patch: { date, time: move.to, ...(move.staffId ? { staffId: move.staffId } : {}) },
        },
      });
      const before = move.b;
      toast.success(
        `Moved to ${minuteLabel(move.to)}${move.staffName ? ` with ${move.staffName}` : ""}.`,
        {
          duration: 10000,
          action: {
            label: "Undo",
            onClick: async () => {
              try {
                await adminUpsertBooking({
                  data: {
                    pin,
                    reference: before.reference,
                    patch: {
                      date,
                      time: before.time,
                      ...(before.staffId ? { staffId: before.staffId } : {}),
                    },
                  },
                });
                toast.success(
                  `Restored to ${minuteLabel(before.time)}${before.staffName ? ` with ${before.staffName}` : ""}.`,
                );
                onChanged();
              } catch {
                toast.error("Couldn't undo — that original time may have been taken.");
              }
            },
          },
        },
      );
      setMove(null);
      onChanged();
    } catch (e) {
      toast.error(
        e instanceof Error && e.message.length < 120
          ? e.message
          : "That time is no longer available.",
      );
    } finally {
      setSaving(false);
    }
  };

  // one column per stylist (and one for any booking without a stylist)
  type Col = {
    id: string;
    staffId: string | undefined;
    name: string;
    photo?: string | null;
    note: string;
    off: { start: number; end: number }[];
    breaks: { start: number; end: number; label?: string }[];
    blocks: { start: number; end: number; label?: string }[];
    bookings: AdminBooking[];
  };
  const team = data.team ?? [];
  // Why a booking can't land at `to` for this stylist (null = free).
  const conflictAt = (b: AdminBooking, to: number, staffId: string | undefined): string | null => {
    const endAt = to + b.minutes;
    const hit = (r: { start: number; end: number }) => to < r.end && endAt > r.start;
    const col = columns.find((c) => (c.staffId ?? "") === (staffId ?? "")) ?? columns[0];
    const who = col?.name ? `${col.name}` : "This stylist";
    if (!col) return null;
    if (col.off.some(hit)) return `${who} isn't working at ${minuteLabel(to)}.`;
    const other = col.bookings.find(
      (x) => x.reference !== b.reference && hit({ start: x.time, end: x.time + x.minutes }),
    );
    if (other)
      return `${who} already has ${other.customer.name || "an appointment"} at ${minuteLabel(other.time)}.`;
    const br = [...plan.breaks, ...col.breaks].find(hit);
    if (br)
      return `That overlaps ${br.label || "a break"} (${minuteLabel(br.start)}–${minuteLabel(br.end)}).`;
    const bl = [...data.blocks, ...plan.blocks, ...col.blocks].find(hit);
    if (bl) return `That time is blocked (${minuteLabel(bl.start)}–${minuteLabel(bl.end)}).`;
    return null;
  };
  const columns: Col[] = team.length
    ? team.map((t) => ({
        id: t.id,
        staffId: t.id,
        name: t.name,
        photo: t.photo,
        note:
          t.working && t.start != null && t.end != null
            ? // the hours they can be booked: within the salon's day (end = last start)
              `${minuteLabel(Math.max(t.start, plan.open))}–${minuteLabel(Math.min(t.end, plan.close))}`
            : "Off today",
        off:
          !t.working || t.start == null || t.end == null
            ? [{ start, end }]
            : [
                ...(t.start > start ? [{ start, end: t.start }] : []),
                // their end time is their last start, so that half hour is still theirs
                ...(t.end + 30 < end ? [{ start: t.end + 30, end }] : []),
              ],
        breaks: t.breaks,
        blocks: t.blocks,
        bookings: visible.filter((b) => b.staffId === t.id),
      }))
    : [
        {
          id: "all",
          staffId: undefined,
          name: "",
          note: "",
          off: [],
          breaks: [],
          blocks: [],
          bookings: visible,
        },
      ];
  const orphans = team.length
    ? visible.filter((b) => !b.staffId || !team.some((t) => t.id === b.staffId))
    : [];
  if (orphans.length)
    columns.push({
      id: "none",
      staffId: undefined,
      name: "No stylist",
      note: "Assign from the booking",
      off: [],
      breaks: [],
      blocks: [],
      bookings: orphans,
    });

  return (
    <>
      {plan.closed ? (
        <p role="status" className="mb-3 text-sm text-muted-foreground">
          Studio closed · {visible.length} existing appointments
        </p>
      ) : null}
      <div
        className="relative isolate overflow-x-auto rounded-md border border-hairline bg-card"
        role="region"
        aria-label="Stylist appointment calendar"
        tabIndex={0}
      >
        <div style={{ minWidth: 64 + columns.length * 240 }}>
          {team.length ? (
            <div className="sticky top-0 z-30 flex border-b border-hairline bg-card">
              <div className="sticky left-0 z-40 w-16 shrink-0 bg-card" />
              {columns.map((c) => (
                <div
                  key={c.id}
                  className="flex min-w-60 flex-1 items-center gap-2.5 border-l border-hairline px-3 py-2 first:border-l-0"
                >
                  {c.staffId ? (
                    <StaffAvatar
                      name={c.name}
                      photo={c.photo}
                      colour={STYLIST_COLOURS[columns.indexOf(c) % STYLIST_COLOURS.length]}
                      className="h-9 w-9"
                    />
                  ) : null}
                  <span className="min-w-0">
                    <span className="block truncate text-[0.88rem] font-medium">{c.name}</span>
                    <span className="block text-[0.7rem] text-muted-foreground">
                      {c.note} · {c.bookings.length} booked
                    </span>
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="relative flex" style={{ height }}>
            {/* hour rail */}
            <div className="sticky left-0 z-30 w-16 shrink-0 border-r border-hairline bg-card">
              {hours.map((m) => (
                <span
                  key={m}
                  className="absolute right-2 -translate-y-1/2 text-[0.7rem] tabular-nums text-muted-foreground"
                  style={{ top: y(m) }}
                >
                  {minuteLabel(m)}
                </span>
              ))}
            </div>
            {columns.map((col) => (
              <div
                key={col.id}
                {...(col.staffId
                  ? { "data-col-staff": col.staffId, "data-col-name": col.name }
                  : {})}
                className="relative min-w-60 flex-1 border-l border-hairline first:border-l-0"
              >
                {hours.map((m) => (
                  <span
                    key={m}
                    className="absolute inset-x-0 border-t border-hairline"
                    style={{ top: y(m) }}
                  />
                ))}
                {/* empty time: click to book there (with this stylist) */}
                <button
                  aria-label={`Book a time${col.staffId ? ` with ${col.name}` : ""}`}
                  disabled={plan.closed}
                  className="absolute inset-0 cursor-copy"
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    onBook(
                      Math.max(
                        start,
                        snap(start + (e.clientY - r.top) / PX_PER_MIN - interval / 2),
                      ),
                      col.staffId,
                    );
                  }}
                />
                {/* outside this stylist's hours */}
                {col.off.map((r, i) => (
                  <div
                    key={`o${i}`}
                    className="pointer-events-none absolute inset-x-0 bg-foreground/[0.05]"
                    style={{ top: y(r.start), height: (r.end - r.start) * PX_PER_MIN }}
                  />
                ))}
                {calendarOverlays(
                  [
                    ...[...plan.breaks, ...col.breaks].map((r) => ({
                      ...r,
                      label: r.label || "Break",
                      kind: "break" as const,
                    })),
                    ...data.blocks.map((r) => ({
                      start: r.start,
                      end: r.end,
                      kind: "block" as const,
                      label:
                        r.kind === "break"
                          ? r.reason || "Break"
                          : `Blocked · ${r.reason || "Unavailable"}`,
                    })),
                    ...plan.blocks
                      .filter(
                        (r) => !data.blocks.some((x) => x.start === r.start && x.end === r.end),
                      )
                      .map((r) => ({
                        start: r.start,
                        end: r.end,
                        label: r.label || "Closed",
                        kind: "block" as const,
                      })),
                    ...col.blocks.map((r) => ({
                      start: r.start,
                      end: r.end,
                      label: r.label || "Unavailable",
                      kind: "block" as const,
                    })),
                  ],
                  start,
                  end,
                ).map((r, i) => (
                  <div
                    key={`k${i}`}
                    title={`${r.label} · ${minuteLabel(r.start)}–${minuteLabel(r.end)}`}
                    className={cn(
                      "pointer-events-none absolute inset-x-0 flex items-center overflow-hidden border-y border-hairline px-3 text-[0.75rem] leading-tight text-muted-foreground",
                      r.kind === "break" ? "bg-muted" : "bg-secondary",
                    )}
                    style={{ top: y(r.start), height: (r.end - r.start) * PX_PER_MIN }}
                  >
                    <span className="truncate">{r.label}</span>
                  </div>
                ))}
                {nowLine != null ? (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
                    style={{ top: y(nowLine) }}
                  >
                    <span className="-ml-1 h-2 w-2 rounded-full bg-bronze" />
                    <span className="h-px flex-1 bg-bronze" />
                  </div>
                ) : null}
                {drag &&
                  (() => {
                    const all = columns.flatMap((c) => c.bookings);
                    const db = all.find((x) => x.reference === drag.ref);
                    if (!db) return null;
                    const own = col.bookings.some((x) => x.reference === drag.ref);
                    const to = Math.max(
                      start,
                      Math.min(end - db.minutes, snap(db.time + drag.dy / PX_PER_MIN)),
                    );
                    const isTarget = (drag.target ?? db.staffId ?? "") === (col.staffId ?? "");
                    const h = Math.max(26, db.minutes * PX_PER_MIN - 2);
                    const bad =
                      isTarget && (to !== db.time || col.staffId !== db.staffId)
                        ? conflictAt(db, to, col.staffId)
                        : null;
                    return (
                      <>
                        {own ? (
                          <div
                            className="pointer-events-none absolute right-1.5 left-1.5 z-[5] flex items-start rounded-md border-2 border-dashed border-muted-foreground/40 px-2.5 py-1 text-[0.7rem] text-muted-foreground"
                            style={{ top: y(db.time), height: h }}
                          >
                            Was {minuteLabel(db.time)}
                          </div>
                        ) : null}
                        {isTarget ? (
                          <div
                            className={`pointer-events-none absolute right-1 left-1 z-[6] rounded-md border-2 ${bad ? "border-destructive bg-destructive/10" : "border-bronze bg-bronze/10"}`}
                            style={{ top: y(to), height: h }}
                          >
                            <span
                              className={`absolute -top-5 right-0 rounded px-1.5 py-0.5 text-[0.68rem] font-medium tabular-nums ${bad ? "bg-destructive text-destructive-foreground" : "bg-bronze text-primary-foreground"}`}
                            >
                              {bad ? "Unavailable" : "Drop"} · {minuteLabel(to)}
                              {col.staffId && col.staffId !== db.staffId ? ` · ${col.name}` : ""}
                            </span>
                          </div>
                        ) : null}
                      </>
                    );
                  })()}
                {col.bookings.map((b) => {
                  const dragging = drag?.ref === b.reference;
                  const top = y(b.time) + (dragging ? drag.dy : 0);
                  const left = dragging ? drag.dx : 0;
                  const ghost = dragging ? snap(b.time + drag.dy / PX_PER_MIN) : null;
                  return (
                    <div
                      key={b.reference}
                      onPointerDown={(e) => onDown(e, b)}
                      onPointerMove={onMove}
                      onPointerUp={(e) => {
                        const wasHold = hold.current != null;
                        cancelHold();
                        if (drag) onUp(b, e);
                        else if (wasHold || e.pointerType === "mouse" || !movable(b))
                          onOpen(b.reference);
                      }}
                      onContextMenu={(e) => e.preventDefault()}
                      onPointerCancel={() => {
                        cancelHold();
                        dragActive.current = false;
                        origin.current = null;
                        setDrag(null);
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === "Enter" && onOpen(b.reference)}
                      className={cn(
                        "absolute right-1.5 left-1.5 z-10 overflow-hidden rounded-md border px-2.5 py-1.5 text-left shadow-sm transition-shadow select-none",
                        BLOCK_TONE[b.status],
                        movable(b)
                          ? dragging
                            ? "cursor-grab touch-none"
                            : "cursor-grab"
                          : "cursor-pointer",
                        pressing === b.reference &&
                          "scale-[0.97] ring-2 ring-bronze/30 transition-transform duration-300",
                        dragging &&
                          "z-30 cursor-grabbing opacity-90 shadow-lg ring-2 ring-bronze/40",
                      )}
                      style={{
                        top,
                        height: Math.max(26, b.minutes * PX_PER_MIN - 2),
                        ...(left ? { transform: `translateX(${left}px)` } : {}),
                        ...(col.staffId
                          ? {
                              borderLeft: `3px solid ${STYLIST_COLOURS[columns.indexOf(col) % STYLIST_COLOURS.length]}`,
                            }
                          : {}),
                      }}
                    >
                      <div className="flex items-baseline justify-between gap-2 text-[0.8rem]">
                        <span className="truncate font-medium">{b.customer.name}</span>
                        <span className="shrink-0 tabular-nums opacity-70">
                          {dragging && ghost != null
                            ? `${minuteLabel(b.time)} → ${minuteLabel(ghost)}`
                            : minuteLabel(b.time)}
                        </span>
                      </div>
                      {b.minutes >= 30 ? (
                        <div className="truncate text-[0.72rem] opacity-70">
                          {b.services.map((s) => s.name).join(" · ")}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-2 text-[0.75rem] text-muted-foreground">
        Press and hold an appointment, then drag it up or down to change its time, or sideways to
        another stylist · click empty time to book · every move is re-checked for clashes.
      </p>

      <Dialog open={Boolean(move)} onOpenChange={(o) => !o && setMove(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-[1.5rem] font-normal">
              Move appointment?
            </DialogTitle>
            <DialogDescription>
              {move
                ? `${move.b.customer.name}: ${minuteLabel(move.b.time)}${move.b.staffName ? ` with ${move.b.staffName}` : ""} → ${minuteLabel(move.to)}${move.staffName ? ` with ${move.staffName}` : ""}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <TinyButton onClick={() => setMove(null)}>Keep time</TinyButton>
            <TinyButton tone="primary" disabled={saving} onClick={() => void confirmMove()}>
              {saving ? "Moving…" : "Move"}
            </TinyButton>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ── week ─────────────────────────────────────────────────── */

function WeekView({
  from,
  onOpen,
  onDay,
}: {
  from: string;
  onOpen: (ref: string) => void;
  onDay: (d: string) => void;
}) {
  const to = addDays(from, 6);
  const { data, loading, error, reload } = useAdminData(
    (p) => adminRange({ data: { pin: p, from, to } }),
    [from],
  );
  const byDay = useMemo(() => {
    const m = new Map<string, AdminBooking[]>();
    for (const b of data?.bookings ?? [])
      if (b.status !== "cancelled") m.set(b.date, [...(m.get(b.date) ?? []), b]);
    return m;
  }, [data]);
  if (!data) return <LoadState loading={loading} error={error} onRetry={reload} />;

  return (
    <div className="grid gap-2 md:grid-cols-7">
      {data.days.map((d) => {
        const list = byDay.get(d.date) ?? [];
        const h = hoursFor(d.date);
        return (
          <div
            key={d.date}
            className={cn(
              "min-h-40 rounded-md border border-hairline bg-card p-2",
              d.date === data.today && "border-bronze/50",
              d.closed && "bg-foreground/[0.03]",
            )}
          >
            <button
              onClick={() => onDay(d.date)}
              className="flex w-full items-baseline justify-between px-1 text-left"
            >
              <span className="text-[0.7rem] uppercase tracking-[0.16em] text-muted-foreground">
                {dateLabel(d.date, { weekday: "short" })}
              </span>
              <span
                className={cn("font-display text-[1.3rem]", d.date === data.today && "text-bronze")}
              >
                {fromISO(d.date).getDate()}
              </span>
            </button>
            {d.closed ? (
              <p className="mt-3 px-1 text-[0.75rem] text-muted-foreground">Closed</p>
            ) : null}
            {!d.closed || list.length ? (
              <>
                {!d.closed ? (
                  <p className="px-1 text-[0.68rem] text-muted-foreground">
                    {minuteLabel(h.open)}–{minuteLabel(h.close)}
                  </p>
                ) : null}
                <div className="mt-2 space-y-1">
                  {list.map((b) => (
                    <button
                      key={b.reference}
                      onClick={() => onOpen(b.reference)}
                      className={cn(
                        "block w-full rounded border px-2 py-1 text-left text-[0.72rem]",
                        BLOCK_TONE[b.status],
                      )}
                    >
                      <span className="tabular-nums opacity-70">{minuteLabel(b.time)}</span>{" "}
                      <span className="truncate">{b.customer.name}</span>
                    </button>
                  ))}
                  {!list.length ? (
                    <p className="px-1 text-[0.72rem] text-muted-foreground/70">No bookings</p>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/* ── month ────────────────────────────────────────────────── */

function MonthView({ month, onDay }: { month: string; onDay: (d: string) => void }) {
  const first = fromISO(month);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const to = toISO(last);
  const { data, loading, error, reload } = useAdminData(
    (p) => adminRange({ data: { pin: p, from: month, to } }),
    [month],
  );
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of data?.bookings ?? [])
      if (b.status !== "cancelled") m.set(b.date, (m.get(b.date) ?? 0) + 1);
    return m;
  }, [data]);
  if (!data) return <LoadState loading={loading} error={error} onRetry={reload} />;

  const lead = (first.getDay() + 6) % 7;
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 pb-1 text-center text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: lead }, (_, i) => (
          <span key={`l${i}`} />
        ))}
        {data.days.map((d) => {
          const n = counts.get(d.date) ?? 0;
          const closed = d.closed || isClosed(d.date);
          return (
            <button
              key={d.date}
              onClick={() => onDay(d.date)}
              className={cn(
                "press flex aspect-square flex-col items-start justify-between rounded-md border border-hairline bg-card p-1.5 text-left sm:p-2.5",
                d.date === data.today && "border-bronze/60",
                closed && "bg-foreground/[0.03] text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "font-display text-[1.1rem] leading-none sm:text-[1.35rem]",
                  d.date === data.today && "text-bronze",
                )}
              >
                {fromISO(d.date).getDate()}
              </span>
              {closed ? <span className="text-[0.62rem]">Closed</span> : null}
              {n ? (
                <span className="rounded-full bg-foreground px-1.5 text-[0.65rem] text-background tabular-nums sm:px-2">
                  {n}
                  <span className="hidden sm:inline"> booked</span>
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
