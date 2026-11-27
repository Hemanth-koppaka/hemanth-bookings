import { closureRangeLabel } from "@/lib/calendar-options";
import { waLink } from "@/lib/whatsapp-link";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { CalendarOff, Clock, Plus, Trash2, UserPlus } from "lucide-react";
import { AdminShell, Empty, Panel, TinyButton, inputClass } from "@/components/admin";
import { LoadState, salonToday, useAdminData } from "@/components/admin-ops";
import { adminSetStylistCode, adminStylistCodes } from "@/lib/stylist.functions";
import { useAdmin } from "@/lib/admin-store";
import {
  adminAddLeave,
  adminStaffBusyDays,
  adminUpdateLeave,
  adminAddStaffBlock,
  adminRemoveStaffTime,
  adminSaveStaff,
  adminStaffList,
  type StaffBreak,
  type StaffHours,
  type StaffMember,
} from "@/lib/admin-staff.functions";
import { minuteLabel } from "@/lib/salon";
import { StaffAvatar, StaffPhotoEditor } from "@/components/staff-avatar";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export const Route = createFileRoute("/hb-desk-7392/staff")({
  head: () => ({
    meta: [
      { property: "og:title", content: "Staff \u2014 Hair by Kiran" },
      { property: "og:description", content: "Stylists, services, hours, breaks and leave." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: "Staff — Hair by Kiran" },
      { name: "description", content: "Stylists, services, hours, breaks and leave." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: StaffScreen,
});

type Data = Extract<Awaited<ReturnType<typeof adminStaffList>>, { available: true }>;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first
const TIMES = Array.from({ length: (23 * 60 - 6 * 60) / 15 + 1 }, (_, i) => 6 * 60 + i * 15);

const blank = (n: number): StaffMember => ({
  id: "",
  name: "",
  gender: "",
  specialties: "",
  active: true,
  bookable: true,
  order: n,
  services: [],
  hours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day: d, working: d !== 2, start: 600, end: 1200 })),
  breaks: [{ day: null, start: 780, end: 840, label: "Lunch" }],
  leave: [],
  blocks: [],
  upcoming: 0,
  photo: null,
  photoUploaded: false,
});

function StaffScreen() {
  const { pin } = useAdmin();
  const { data, loading, error, reload } = useAdminData(
    (p) => adminStaffList({ data: { pin: p } }),
    [],
  );
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const info = data && data.available ? (data as Data) : null;

  return (
    <AdminShell
      title="Staff"
      subtitle="Who can be booked, for what, and when. Booking times follow this automatically."
      right={
        info ? (
          <TinyButton tone="primary" onClick={() => setEditing(blank(info.staff.length))}>
            <UserPlus className="h-4 w-4" /> Add stylist
          </TinyButton>
        ) : null
      }
    >
      <LoadState loading={loading && !data} error={error} onRetry={reload} />
      {data && !data.available ? (
        <Empty title="Staff appears once the latest database update (0008) has been applied." />
      ) : null}
      {info ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {info.staff.map((s) => (
            <button
              key={s.id}
              onClick={() => setEditing(s)}
              className={cn(
                "press rounded-md border border-hairline bg-card p-5 text-left hover:border-foreground/30",
                !s.active && "opacity-60",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <StaffAvatar name={s.name} photo={s.photo} className="h-14 w-14 text-[1.2rem]" />
                <div className="min-w-0 flex-1">
                  <div className="font-display text-[1.5rem] leading-tight">{s.name}</div>
                  <div className="text-[0.8rem] text-muted-foreground">
                    {s.specialties ||
                      (s.gender ? s.gender[0]!.toUpperCase() + s.gender.slice(1) : "Stylist")}
                  </div>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full border px-2 py-0.5 text-[0.62rem] uppercase tracking-[0.12em]",
                    !s.active
                      ? "border-foreground/20 text-muted-foreground"
                      : s.bookable
                        ? "border-emerald-700/30 text-emerald-700"
                        : "border-amber-600/40 text-amber-700",
                  )}
                >
                  {!s.active ? "Inactive" : s.bookable ? "Bookable" : "Not online"}
                </span>
              </div>
              <div className="mt-3 text-[0.82rem] text-muted-foreground">
                {s.services.length} services · {s.hours.filter((h) => h.working).length} days a week
              </div>
              <div className="mt-1 text-[0.82rem] text-muted-foreground">
                {ORDER.filter((d) => s.hours[d]?.working)
                  .map((d) => DAYS[d])
                  .join(" ")}
              </div>
              {s.leave.length ? (
                <div className="mt-2 text-[0.8rem] text-amber-700">
                  On leave{" "}
                  {closureRangeLabel({
                    start: s.leave[0]!.start,
                    end: s.leave[0]!.end,
                    reason: "",
                  })}
                  {s.leave.length > 1 ? ` +${s.leave.length - 1}` : ""}
                </div>
              ) : null}
              <div className="mt-2 text-[0.8rem]">
                {s.upcoming} upcoming appointment{s.upcoming === 1 ? "" : "s"}
              </div>
            </button>
          ))}
        </div>
      ) : null}
      {info ? (
        <StaffEditor
          member={editing}
          info={info}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      ) : null}
    </AdminShell>
  );
}

function Section({ title, children, hint }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="border-t border-hairline pt-4">
      <div className="text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground">{title}</div>
      {hint ? <p className="mt-0.5 text-[0.75rem] text-muted-foreground">{hint}</p> : null}
      <div className="mt-2">{children}</div>
    </section>
  );
}

const TimeSelect = ({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
}) => (
  <select
    aria-label={label}
    value={value}
    onChange={(e) => onChange(Number(e.target.value))}
    className="rounded-md border border-foreground/15 bg-background px-2 py-1.5 text-[0.85rem] tabular-nums"
  >
    {TIMES.map((t) => (
      <option key={t} value={t}>
        {minuteLabel(t)}
      </option>
    ))}
  </select>
);

function StaffEditor({
  member,
  info,
  onClose,
  onSaved,
}: {
  member: StaffMember | null;
  info: Data;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { pin } = useAdmin();
  const [f, setF] = useState<StaffMember | null>(member);
  const [busy, setBusy] = useState(false);
  useEffect(() => setF(member), [member]);
  const groups = useMemo(
    () =>
      info.categories
        .map((c) => ({ ...c, services: info.services.filter((s) => s.categoryId === c.id) }))
        .filter((c) => c.services.length),
    [info],
  );
  if (!f) return null;
  const set = (p: Partial<StaffMember>) => setF((c) => (c ? { ...c, ...p } : c));
  const setHours = (day: number, p: Partial<StaffHours>) =>
    set({ hours: f.hours.map((h) => (h.day === day ? { ...h, ...p } : h)) });
  const setBreak = (i: number, p: Partial<StaffBreak>) =>
    set({ breaks: f.breaks.map((b, j) => (j === i ? { ...b, ...p } : b)) });
  const toggle = (ids: string[], on: boolean) =>
    set({
      services: on
        ? [...new Set([...f.services, ...ids])]
        : f.services.filter((x) => !ids.includes(x)),
    });

  const save = async () => {
    if (!f.name.trim()) return void toast.error("Add a name.");
    setBusy(true);
    try {
      const r = await adminSaveStaff({
        data: {
          pin,
          staff: {
            ...(f.id ? { id: f.id } : {}),
            name: f.name,
            gender: f.gender as "",
            specialties: f.specialties,
            active: f.active,
            bookable: f.bookable,
            order: f.order,
            services: f.services,
            hours: f.hours,
            breaks: f.breaks.map((b) => ({
              day: b.day,
              start: b.start,
              end: b.end,
              label: b.label,
            })),
          },
        },
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${f.name} saved. Booking times update straight away.`);
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error && e.message.length < 160 ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={Boolean(member)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-[34rem]">
        <SheetHeader className="sticky top-0 z-10 border-b border-hairline bg-background/95 px-5 py-4 text-left backdrop-blur">
          <SheetTitle className="font-display text-[1.6rem] font-normal">
            {f.id ? f.name || "Stylist" : "New stylist"}
          </SheetTitle>
          <SheetDescription>
            {f.id
              ? `${f.upcoming} upcoming appointment${f.upcoming === 1 ? "" : "s"}`
              : "Shows up in booking times as soon as you save."}
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-5 py-5">
          {f.id ? (
            <StaffPhotoEditor
              staffId={f.id}
              name={f.name}
              photo={f.photo}
              uploaded={f.photoUploaded}
              onChange={(url) => {
                set({ photo: url ?? null, photoUploaded: Boolean(url) });
                onSaved();
              }}
            />
          ) : (
            <p className="text-[0.8rem] text-muted-foreground">You can add a photo after saving.</p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground">
                Name
              </span>
              <input
                className={inputClass}
                value={f.name}
                onChange={(e) => set({ name: e.target.value })}
                maxLength={80}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground">
                Gender
              </span>
              <select
                className={inputClass}
                value={f.gender}
                onChange={(e) => set({ gender: e.target.value })}
              >
                <option value="">—</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground">
                Specialties (shown to guests)
              </span>
              <input
                className={inputClass}
                value={f.specialties}
                onChange={(e) => set({ specialties: e.target.value })}
                maxLength={160}
                placeholder="e.g. Fades, beard sculpting"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-[0.88rem]">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--bronze)]"
                checked={f.active}
                onChange={(e) => set({ active: e.target.checked })}
              />{" "}
              Works here (active)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--bronze)]"
                checked={f.bookable}
                onChange={(e) => set({ bookable: e.target.checked })}
              />{" "}
              Guests can book online
            </label>
          </div>

          <Section title="Services" hint="Only these can be booked with this stylist.">
            <div className="space-y-3">
              {groups.map((g) => {
                const ids = g.services.map((s) => s.id);
                const all = ids.every((id) => f.services.includes(id));
                return (
                  <div key={g.id}>
                    <label className="flex items-center gap-2 text-[0.82rem] font-medium">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[var(--bronze)]"
                        checked={all}
                        onChange={(e) => toggle(ids, e.target.checked)}
                      />
                      {g.name}{" "}
                      <span className="text-muted-foreground capitalize">· {g.audience}</span>
                    </label>
                    <div className="mt-1 flex flex-wrap gap-1.5 pl-6">
                      {g.services.map((s) => {
                        const on = f.services.includes(s.id);
                        return (
                          <button
                            key={s.id}
                            onClick={() => toggle([s.id], !on)}
                            className={cn(
                              "press rounded-full border px-2.5 py-0.5 text-[0.75rem]",
                              on
                                ? "border-foreground bg-foreground text-background"
                                : "border-foreground/15",
                            )}
                          >
                            {s.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>

          <Section
            title="Working hours"
            hint="First and last appointment times (the last one can run past it)."
          >
            <div className="space-y-1.5">
              {ORDER.map((d) => {
                const h = f.hours.find((x) => x.day === d)!;
                return (
                  <div key={d} className="flex flex-wrap items-center gap-2">
                    <label className="flex w-20 items-center gap-2 text-[0.85rem]">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[var(--bronze)]"
                        checked={h.working}
                        onChange={(e) => setHours(d, { working: e.target.checked })}
                      />
                      {DAYS[d]}
                    </label>
                    {h.working ? (
                      <>
                        <TimeSelect
                          label={`${DAYS[d]} start`}
                          value={h.start}
                          onChange={(v) => setHours(d, { start: v })}
                        />
                        <span className="text-muted-foreground">–</span>
                        <TimeSelect
                          label={`${DAYS[d]} end`}
                          value={h.end}
                          onChange={(v) => setHours(d, { end: v })}
                        />
                      </>
                    ) : (
                      <span className="text-[0.82rem] text-muted-foreground">Day off</span>
                    )}
                  </div>
                );
              })}
            </div>
          </Section>

          <Section title="Breaks" hint="Only this stylist is unavailable; others stay bookable.">
            <div className="space-y-1.5">
              {f.breaks.map((b, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Day"
                    value={b.day ?? ""}
                    onChange={(e) =>
                      setBreak(i, { day: e.target.value === "" ? null : Number(e.target.value) })
                    }
                    className="rounded-md border border-foreground/15 bg-background px-2 py-1.5 text-[0.85rem]"
                  >
                    <option value="">Every day</option>
                    {ORDER.map((d) => (
                      <option key={d} value={d}>
                        {DAYS[d]}
                      </option>
                    ))}
                  </select>
                  <TimeSelect
                    label="Break start"
                    value={b.start}
                    onChange={(v) => setBreak(i, { start: v })}
                  />
                  <span className="text-muted-foreground">–</span>
                  <TimeSelect
                    label="Break end"
                    value={b.end}
                    onChange={(v) => setBreak(i, { end: v })}
                  />
                  <input
                    aria-label="Label"
                    className="w-24 rounded-md border border-foreground/15 px-2 py-1.5 text-[0.85rem]"
                    value={b.label}
                    onChange={(e) => setBreak(i, { label: e.target.value })}
                  />
                  <button
                    aria-label="Remove break"
                    onClick={() => set({ breaks: f.breaks.filter((_, j) => j !== i) })}
                    className="press p-1 text-foreground/50 hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                </div>
              ))}
              <TinyButton
                onClick={() =>
                  set({
                    breaks: [...f.breaks, { day: null, start: 780, end: 840, label: "Break" }],
                  })
                }
              >
                <Plus className="h-3.5 w-3.5" /> Add break
              </TinyButton>
            </div>
          </Section>

          <div className="sticky bottom-0 -mx-5 flex justify-end gap-2 border-t border-hairline bg-background/95 px-5 py-3 backdrop-blur">
            <TinyButton onClick={onClose}>Cancel</TinyButton>
            <TinyButton tone="primary" disabled={busy} onClick={() => void save()}>
              {busy ? "Saving…" : f.id ? "Save" : "Add stylist"}
            </TinyButton>
          </div>

          {f.id ? (
            <TimeOff
              member={f}
              team={info.staff.filter((x) => x.id !== f.id && x.active)}
              onChanged={onSaved}
            />
          ) : null}
          {f.id ? <StylistCode staffId={f.id} name={f.name} /> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

type Affected = {
  reference: string;
  date: string;
  time: number;
  name: string;
  phone?: string;
  /** the stylist, when it isn't the one being edited ("Also for") */
  with?: string;
};

/** A ready-written WhatsApp note asking the guest to pick a new time. */
function rebookText(c: Affected, stylist: string) {
  const day = new Date(c.date + "T00:00:00").toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const link =
    typeof window !== "undefined"
      ? `${window.location.origin}/manage?ref=${encodeURIComponent(c.reference)}`
      : "";
  return [
    `Hello ${c.name || "there"}, this is Hair by Kiran.`,
    `We're sorry, ${stylist} won't be available for your appointment on ${day} at ${minuteLabel(c.time)}.`,
    `Please choose a new time here: ${link}`,
    "Or just reply to this message and we'll arrange it for you. Thank you!",
  ].join("\n\n");
}

/** Tapped dates (any order) as runs of consecutive days. */
function toRuns(dates: string[]): { start: string; end: string }[] {
  const next = (iso: string) => {
    const d = new Date(iso + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  };
  const runs: { start: string; end: string }[] = [];
  for (const d of [...new Set(dates)].sort()) {
    const last = runs.at(-1);
    if (last && next(last.end) === d) last.end = d;
    else runs.push({ start: d, end: d });
  }
  return runs;
}
const runsLabel = (runs: { start: string; end: string }[]) =>
  runs.map((r) => closureRangeLabel({ ...r, reason: "" })).join(", ");

/**
 * Leave by tapping days on a month calendar. Tap days one by one, or switch to
 * "First & last day" for a long trip. Days with bookings show a dot; days
 * already on leave are shaded.
 */
function LeaveCalendar({
  staffId,
  picked,
  onChange,
  taken,
}: {
  staffId: string;
  picked: string[];
  onChange: (d: string[]) => void;
  taken: { start: string; end: string }[];
}) {
  const { pin } = useAdmin();
  const today = salonToday();
  const [view, setView] = useState(() => today.slice(0, 7)); // YYYY-MM
  const [range, setRange] = useState(false);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, number>>({});
  const [y, m] = view.split("-").map(Number) as [number, number];
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const iso = (d: number) => `${view}-${String(d).padStart(2, "0")}`;
  useEffect(() => {
    let live = true;
    adminStaffBusyDays({ data: { pin, staffId, from: iso(1), to: iso(daysIn) } })
      .then((r) => live && setBusy((b) => ({ ...b, ...r })))
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, staffId, pin]);
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Monday first
  const onLeave = (d: string) => taken.some((t) => t.start <= d && d <= t.end);
  const shift = (n: number) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setView(d.toISOString().slice(0, 7));
  };
  const canBack = view > today.slice(0, 7);
  const tap = (d: string) => {
    if (!range) {
      onChange(picked.includes(d) ? picked.filter((x) => x !== d) : [...picked, d].sort());
      return;
    }
    if (!anchor) {
      setAnchor(d);
      onChange([...new Set([...picked, d])].sort());
      return;
    }
    const [a, b] = anchor < d ? [anchor, d] : [d, anchor];
    const all: string[] = [];
    for (
      let t = new Date(a + "T00:00:00Z");
      t.toISOString().slice(0, 10) <= b;
      t.setUTCDate(t.getUTCDate() + 1)
    ) {
      const x = t.toISOString().slice(0, 10);
      if (!onLeave(x)) all.push(x);
    }
    onChange([...new Set([...picked, ...all])].sort());
    setAnchor(null);
  };
  const runs = toRuns(picked);
  return (
    <div className="mt-2 max-w-sm rounded-md border border-hairline p-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={!canBack}
          onClick={() => shift(-1)}
          aria-label="Previous month"
          className="press rounded-md px-2 py-1 disabled:opacity-30"
        >
          ‹
        </button>
        <div className="font-display text-[1.05rem]">
          {new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", {
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          })}
        </div>
        <button
          type="button"
          onClick={() => shift(1)}
          aria-label="Next month"
          className="press rounded-md px-2 py-1"
        >
          ›
        </button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1 rounded-md bg-foreground/[0.05] p-1 text-[0.75rem]">
        {[
          { on: false, label: "Tap days" },
          { on: true, label: "First & last day" },
        ].map((o) => (
          <button
            key={o.label}
            type="button"
            onClick={() => {
              setRange(o.on);
              setAnchor(null);
            }}
            className={cn(
              "rounded py-1.5",
              range === o.on ? "bg-card shadow-sm" : "text-muted-foreground",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-7 text-center text-[0.62rem] uppercase tracking-[0.12em] text-muted-foreground">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {Array.from({ length: lead }, (_, k) => (
          <span key={"e" + k} />
        ))}
        {Array.from({ length: daysIn }, (_, k) => {
          const d = iso(k + 1);
          const past = d < today;
          const off = onLeave(d);
          const on = picked.includes(d);
          const n = busy[d] ?? 0;
          return (
            <button
              key={d}
              type="button"
              disabled={past || off}
              onClick={() => tap(d)}
              aria-pressed={on}
              aria-label={`${d}${off ? " (already on leave)" : ""}${n ? ` (${n} booking${n === 1 ? "" : "s"})` : ""}`}
              title={off ? "Already on leave" : n ? `${n} booking${n === 1 ? "" : "s"}` : undefined}
              className={cn(
                "press relative flex h-9 items-center justify-center rounded-md text-[0.85rem] tabular-nums",
                on
                  ? "bg-foreground text-background"
                  : off
                    ? "bg-amber-500/15 text-amber-800"
                    : past
                      ? "text-muted-foreground/40"
                      : "hover:bg-foreground/[0.06]",
                anchor === d && "ring-2 ring-bronze",
              )}
            >
              {k + 1}
              {n && !past ? (
                <span
                  aria-hidden
                  className={cn(
                    "absolute bottom-1 h-1 w-1 rounded-full",
                    on ? "bg-background" : "bg-bronze",
                  )}
                />
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-start justify-between gap-2 text-[0.78rem]">
        <span className="text-muted-foreground">
          {runs.length
            ? `${picked.length} day${picked.length === 1 ? "" : "s"}: ${runsLabel(runs)}`
            : range
              ? anchor
                ? "Now tap the last day."
                : "Tap the first day, then the last."
              : "Tap each day off. Dots = days with bookings."}
        </span>
        {picked.length ? (
          <button
            type="button"
            onClick={() => {
              onChange([]);
              setAnchor(null);
            }}
            className="shrink-0 underline underline-offset-4"
          >
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Leave (whole days) and temporary unavailability (hours on a date). */
function TimeOff({
  member,
  team,
  onChanged,
}: {
  member: StaffMember;
  /** the other active stylists (the same leave can be added for them too) */
  team: StaffMember[];
  onChanged: () => void;
}) {
  const { pin } = useAdmin();
  const today = salonToday();
  // "Also for": the same leave for others in one go (e.g. a couple's trip). The last
  // choice per stylist is remembered on this device, so the usual partner is pre-ticked.
  const alsoKey = `hb-leave-also-${member.id}`;
  const [also, setAlso] = useState<string[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(alsoKey) ?? "[]") as unknown;
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  });
  const alsoNow = also.filter((id) => team.some((t) => t.id === id));
  const toggleAlso = (id: string) => {
    const next = alsoNow.includes(id) ? alsoNow.filter((x) => x !== id) : [...alsoNow, id];
    setAlso(next);
    try {
      localStorage.setItem(alsoKey, JSON.stringify(next));
    } catch {
      /* remembering is optional */
    }
  };
  const [lv, setLv] = useState({ start: today, end: today, reason: "" });
  /** back on the last day at this minute (null = away the whole last day) */
  const [backAt, setBackAt] = useState<number | null>(null);
  const [bl, setBl] = useState({ date: today, start: 960, end: 1080, reason: "" });
  const [clash, setClash] = useState<{
    kind: "leave" | "block";
    /** the time block awaiting "Save anyway" */
    block?: typeof bl;
    list: Affected[];
  } | null>(null);
  /** bookings kept despite the time off: guests to tell, with one-tap WhatsApp */
  const [tell, setTell] = useState<{ list: Affected[]; sent: string[] } | null>(null);
  const keepTell = (r: { clashes?: Affected[] }) =>
    r.clashes?.length ? setTell({ list: r.clashes, sent: [] }) : undefined;
  const [leave, setLeave] = useState(member.leave);
  /** the leave being edited (its earliest allowed start: today, or its own start if it began) */
  const [editingLeave, setEditingLeave] = useState<{ id: string; minStart: string } | null>(null);
  const [blocks, setBlocks] = useState(member.blocks);
  useEffect(() => {
    setLeave(member.leave);
    setBlocks(member.blocks);
  }, [member]);

  const startEditLeave = (l: (typeof leave)[number]) => {
    setLv({ start: l.start, end: l.end, reason: l.reason ?? "" });
    setEditingLeave({ id: l.id, minStart: l.start < today ? l.start : today });
    setClash(null);
  };
  const stopEditLeave = () => {
    setEditingLeave(null);
    setLv({ start: today, end: today, reason: "" });
    setClash(null);
  };
  const saveLeave = async (confirm = false) => {
    if (!editingLeave) return;
    const r = await adminUpdateLeave({
      data: { pin, id: editingLeave.id, ...lv, ...(confirm ? { confirm: true } : {}) },
    }).catch(() => null);
    if (!r) return void toast.error("Couldn't save the changes.");
    if (!r.ok && "clashes" in r && r.clashes?.length)
      return setClash({ kind: "leave", list: r.clashes });
    if (!r.ok) return void toast.error(("error" in r && r.error) || "Couldn't save.");
    toast.success(`Leave updated: ${lv.start}${lv.end !== lv.start ? ` → ${lv.end}` : ""}.`);
    setLeave((x) => x.map((y) => (y.id === editingLeave.id ? { ...y, ...lv } : y)));
    stopEditLeave();
    onChanged();
  };
  // dates tapped on the calendar, saved as one leave per run of consecutive days
  const [picked, setPicked] = useState<string[]>([]);
  const addLeave = async (confirm = false) => {
    const runs = toRuns(picked);
    if (!runs.length) return void toast.error("Tap the days off on the calendar first.");
    const r = await adminAddLeave({
      data: {
        pin,
        staffId: member.id,
        start: runs[0]!.start,
        end: runs[0]!.end,
        ...(runs.length > 1 ? { more: runs.slice(1) } : {}),
        reason: lv.reason,
        ...(alsoNow.length ? { alsoFor: alsoNow } : {}),
        ...(backAt != null ? { backAt } : {}),
        ...(confirm ? { confirm: true } : {}),
      },
    }).catch(() => null);
    if (!r) return void toast.error("Couldn't save the leave.");
    if (!r.ok && "clashes" in r && r.clashes?.length)
      return setClash({ kind: "leave", list: r.clashes });
    if (!r.ok) return void toast.error(("error" in r && r.error) || "Couldn't save.");
    const who = [member.name, ...team.filter((t) => alsoNow.includes(t.id)).map((t) => t.name)];
    toast.success(`${who.join(" & ")} on leave ${runsLabel(runs)}.`);
    setClash(null);
    keepTell(r);
    if ("leaves" in r && r.leaves) setLeave((x) => [...x, ...r.leaves]);
    if ("block" in r && r.block) setBlocks((x) => [...x, r.block!]);
    setBackAt(null);
    setPicked([]);
    setLv((x) => ({ ...x, reason: "" }));
    onChanged();
  };
  const addBlock = async (confirm = false, b = bl) => {
    const r = await adminAddStaffBlock({
      data: { pin, staffId: member.id, ...b, ...(confirm ? { confirm: true } : {}) },
    }).catch(() => null);
    if (!r) return void toast.error("Couldn't save.");
    if (!r.ok && "clashes" in r && r.clashes?.length)
      return setClash({ kind: "block", list: r.clashes, block: b });
    if (!r.ok) return void toast.error(("error" in r && r.error) || "Couldn't save.");
    toast.success(
      `${member.name} unavailable ${minuteLabel(b.start)}–${b.end >= 1440 ? "close" : minuteLabel(b.end)} on ${b.date}.`,
    );
    setClash(null);
    keepTell(r);
    setBlocks((x) => [...x, { id: ("id" in r && r.id) || crypto.randomUUID(), ...b }]);
    onChanged();
  };
  /** sudden absence: no more bookings for this stylist from now until close */
  const offRestOfToday = () => {
    const d = new Date(Date.now() + 330 * 60_000);
    const start = Math.floor((d.getUTCHours() * 60 + d.getUTCMinutes()) / 15) * 15;
    void addBlock(false, { date: today, start, end: 1440, reason: "Off rest of today" });
  };
  const remove = async (kind: "leave" | "block", id: string) => {
    await adminRemoveStaffTime({ data: { pin, kind, id } }).catch(() => null);
    if (kind === "leave") setLeave((x) => x.filter((y) => y.id !== id));
    else setBlocks((x) => x.filter((y) => y.id !== id));
    onChanged();
  };

  return (
    <Panel className="space-y-4">
      <div className="flex items-center gap-2">
        <CalendarOff className="h-4 w-4 text-bronze" strokeWidth={1.5} />
        <span className="font-display text-[1.3rem]">Time off</span>
      </div>
      <p className="text-[0.78rem] text-muted-foreground">
        Only {member.name} becomes unavailable; the salon and other stylists stay open. Existing
        bookings stay booked — you'll see any clashes.
      </p>

      <div>
        <div className="text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground">Leave</div>
        <ul className="mt-1 space-y-1 text-[0.85rem]">
          {leave.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-2">
              <span>
                {closureRangeLabel({ start: l.start, end: l.end, reason: "" })}{" "}
                {l.reason ? <span className="text-muted-foreground">· {l.reason}</span> : null}
              </span>
              <span className="flex shrink-0 gap-3">
                <button
                  onClick={() => startEditLeave(l)}
                  className={
                    "text-[0.75rem] underline underline-offset-4 " +
                    (editingLeave?.id === l.id
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground")
                  }
                >
                  {editingLeave?.id === l.id ? "Editing…" : "Edit"}
                </button>
                <button
                  onClick={() => void remove("leave", l.id)}
                  className="text-[0.75rem] text-muted-foreground underline underline-offset-4 hover:text-destructive"
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
          {!leave.length ? <li className="text-muted-foreground">None planned.</li> : null}
        </ul>
        {editingLeave ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={lv.start}
              min={editingLeave?.minStart ?? today}
              onChange={(e) =>
                setLv({
                  ...lv,
                  start: e.target.value,
                  end: e.target.value > lv.end ? e.target.value : lv.end,
                })
              }
              className="rounded-md border border-foreground/15 px-2 py-1.5 text-[0.85rem]"
              aria-label="Leave from"
            />
            <span className="text-muted-foreground">→</span>
            <input
              type="date"
              value={lv.end}
              min={lv.start}
              onChange={(e) => setLv({ ...lv, end: e.target.value })}
              className="rounded-md border border-foreground/15 px-2 py-1.5 text-[0.85rem]"
              aria-label="Leave to"
            />
            <input
              value={lv.reason}
              onChange={(e) => setLv({ ...lv, reason: e.target.value })}
              placeholder="Reason"
              className="w-32 rounded-md border border-foreground/15 px-2 py-1.5 text-[0.85rem]"
            />
            <TinyButton tone="primary" onClick={() => void saveLeave()}>
              Save changes
            </TinyButton>
            <button
              onClick={stopEditLeave}
              className="text-[0.75rem] text-muted-foreground underline underline-offset-4"
            >
              Cancel
            </button>
          </div>
        ) : (
          <>
            <LeaveCalendar staffId={member.id} picked={picked} onChange={setPicked} taken={leave} />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select
                value={backAt ?? ""}
                onChange={(e) => setBackAt(e.target.value === "" ? null : Number(e.target.value))}
                className="rounded-md border border-foreground/15 px-2 py-1.5 text-[0.85rem]"
                aria-label="Back on the last day at"
                title="If they arrive during the last day, pick the time they'll be back"
              >
                <option value="">Whole last day off</option>
                {Array.from({ length: 25 }, (_, k) => 600 + k * 30).map((m) => (
                  <option key={m} value={m}>
                    Back at {minuteLabel(m)}
                  </option>
                ))}
              </select>
              <input
                value={lv.reason}
                onChange={(e) => setLv({ ...lv, reason: e.target.value })}
                placeholder="Reason"
                className="w-32 rounded-md border border-foreground/15 px-2 py-1.5 text-[0.85rem]"
              />
              <TinyButton tone="primary" onClick={() => void addLeave()}>
                Add leave
              </TinyButton>
            </div>
          </>
        )}
        {!editingLeave && team.length ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[0.8rem]">
            <span className="text-muted-foreground">Also for</span>
            {team.map((t) => (
              <label key={t.id} className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={alsoNow.includes(t.id)}
                  onChange={() => toggleAlso(t.id)}
                  className="h-4 w-4 accent-foreground"
                />
                {t.name}
              </label>
            ))}
          </div>
        ) : null}
      </div>

      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground">
            Unavailable for a few hours
          </div>
          <button
            type="button"
            onClick={() =>
              window.confirm(`No more bookings for ${member.name} for the rest of today?`) &&
              offRestOfToday()
            }
            className="text-[0.75rem] underline underline-offset-4 hover:text-destructive"
          >
            Off rest of today
          </button>
        </div>
        <ul className="mt-1 space-y-1 text-[0.85rem]">
          {blocks.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-2">
              <span>
                <Clock
                  className="mr-1 inline h-3.5 w-3.5 text-muted-foreground"
                  strokeWidth={1.5}
                />
                {b.date} · {minuteLabel(b.start)}–{b.end >= 1440 ? "close" : minuteLabel(b.end)}{" "}
                {b.reason ? <span className="text-muted-foreground">· {b.reason}</span> : null}
              </span>
              <button
                onClick={() => void remove("block", b.id)}
                className="text-[0.75rem] text-muted-foreground underline underline-offset-4 hover:text-destructive"
              >
                Remove
              </button>
            </li>
          ))}
          {!blocks.length ? <li className="text-muted-foreground">None.</li> : null}
        </ul>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={bl.date}
            min={today}
            onChange={(e) => setBl({ ...bl, date: e.target.value })}
            className="rounded-md border border-foreground/15 px-2 py-1.5 text-[0.85rem]"
            aria-label="Date"
          />
          <TimeSelect label="From" value={bl.start} onChange={(v) => setBl({ ...bl, start: v })} />
          <span className="text-muted-foreground">–</span>
          <TimeSelect label="Until" value={bl.end} onChange={(v) => setBl({ ...bl, end: v })} />
          <input
            value={bl.reason}
            onChange={(e) => setBl({ ...bl, reason: e.target.value })}
            placeholder="Reason"
            className="w-32 rounded-md border border-foreground/15 px-2 py-1.5 text-[0.85rem]"
          />
          <TinyButton onClick={() => void addBlock()}>Block</TinyButton>
        </div>
      </div>

      {tell ? (
        <div className="rounded-md border border-emerald-700/25 bg-emerald-500/[0.07] p-3 text-[0.85rem]">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-medium">Let these guests know</span>
            <button
              onClick={() => setTell(null)}
              className="text-[0.75rem] text-muted-foreground underline underline-offset-4"
            >
              Done
            </button>
          </div>
          <p className="mt-0.5 text-[0.78rem] text-muted-foreground">
            Their bookings are kept. Each button opens WhatsApp with a note and a link to pick a new
            time; you tap Send.
          </p>
          <ul className="mt-2 space-y-1.5">
            {tell.list.map((c) => {
              const sent = tell.sent.includes(c.reference);
              return (
                <li key={c.reference} className="flex items-center justify-between gap-2">
                  <span className="min-w-0">
                    {c.date} {minuteLabel(c.time)} · {c.name}
                    {c.with ? (
                      <span className="text-muted-foreground"> (with {c.with})</span>
                    ) : null}
                  </span>
                  {c.phone ? (
                    <a
                      href={waLink(c.phone, rebookText(c, c.with ?? member.name))}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() =>
                        setTell((t) => (t ? { ...t, sent: [...t.sent, c.reference] } : t))
                      }
                      className={
                        "shrink-0 rounded-full px-3 py-1 text-[0.75rem] " +
                        (sent
                          ? "border border-emerald-700/30 text-emerald-800"
                          : "bg-[#1f7a4d] text-white")
                      }
                    >
                      {sent ? "Opened ✓" : "WhatsApp"}
                    </a>
                  ) : (
                    <span className="text-[0.75rem] text-muted-foreground">No number</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {clash ? (
        <div className="rounded-md border border-amber-600/30 bg-amber-500/10 p-3 text-[0.85rem]">
          {member.name} has {clash.list.length} booking{clash.list.length > 1 ? "s" : ""} in that
          time:
          <ul className="mt-1 list-disc pl-5">
            {clash.list.map((c) => (
              <li key={c.reference}>
                {c.date} {minuteLabel(c.time)} · {c.name}
                {c.with ? ` (with ${c.with})` : ""} ({c.reference})
              </li>
            ))}
          </ul>
          They stay booked — move or reassign them from the calendar. Save anyway?
          <div className="mt-2 flex gap-2">
            <TinyButton
              tone="primary"
              onClick={() =>
                void (clash.kind === "leave"
                  ? editingLeave
                    ? saveLeave(true)
                    : addLeave(true)
                  : addBlock(true, clash.block))
              }
            >
              Save anyway
            </TinyButton>
            <TinyButton onClick={() => setClash(null)}>Cancel</TinyButton>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

/** The stylist's own code for "My day" on their phone (/stylist). */
function StylistCode({ staffId, name }: { staffId: string; name: string }) {
  const { pin } = useAdmin();
  const [has, setHas] = useState<boolean | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    adminStylistCodes({ data: { pin } })
      .then((r) => setHas(r.withCode.includes(staffId)))
      .catch(() => setHas(false));
  }, [pin, staffId]);
  const save = async (value: string) => {
    setBusy(true);
    try {
      const r = await adminSetStylistCode({ data: { pin, staffId, code: value } });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setHas(Boolean(value));
      setCode("");
      toast.success(
        value ? `${name} can now open My day with this code.` : `${name}'s code removed.`,
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section
      title="My day on their phone"
      hint={`${name} opens ${typeof window !== "undefined" ? window.location.origin : ""}/stylist, signs in with this code and sees only their own appointments. A new code signs them out everywhere.`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={inputClass + " max-w-[14rem]"}
          type="text"
          autoComplete="off"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={has ? "New code" : "Set a code (6+ characters)"}
          aria-label="Stylist code"
        />
        <TinyButton
          tone="primary"
          disabled={busy || code.trim().length < 6}
          onClick={() => void save(code)}
        >
          {has ? "Change code" : "Set code"}
        </TinyButton>
        {has ? (
          <TinyButton tone="danger" disabled={busy} onClick={() => void save("")}>
            Remove
          </TinyButton>
        ) : null}
        <span className="text-[0.78rem] text-muted-foreground">
          {has == null ? "" : has ? "Code set" : "No code yet"}
        </span>
      </div>
    </Section>
  );
}
