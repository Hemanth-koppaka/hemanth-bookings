import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { AdminShell, Empty, Panel, TinyButton } from "@/components/admin";
import { LoadState, salonToday, useAdminData } from "@/components/admin-ops";
import { useAdmin } from "@/lib/admin-store";
import {
  adminAddClosure,
  adminClosures,
  adminReopen,
  adminUpdateClosure,
} from "@/lib/admin-staff.functions";
import { fromISO, minuteLabel } from "@/lib/salon";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/hb-desk-7392/closures")({
  head: () => ({
    meta: [
      { property: "og:title", content: "Salon closures \u2014 Hair by Kiran" },
      {
        property: "og:description",
        content: "Close the whole salon for hours, days or until further notice.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: "Salon closures — Hair by Kiran" },
      {
        name: "description",
        content: "Close the whole salon for hours, days or until further notice.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ClosuresScreen,
});

type Kind = "days" | "dates" | "hours" | "open";
const KINDS: { key: Kind; label: string; hint: string }[] = [
  { key: "days", label: "Date range", hint: "Consecutive days, e.g. 15 → 20 November." },
  { key: "dates", label: "Separate dates", hint: "Several individual dates." },
  { key: "hours", label: "A few hours", hint: "Part of one day." },
  { key: "open", label: "Until further notice", hint: "Stays closed until you reopen." },
];
const REASONS = [
  "Festival Holiday",
  "Holiday",
  "Maintenance",
  "Private event",
  "Emergency",
  "Renovation",
];
const TIMES = Array.from({ length: (22 * 60 - 7 * 60) / 15 + 1 }, (_, i) => 7 * 60 + i * 15);
const nice = (iso: string) =>
  fromISO(iso).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

function ClosuresScreen() {
  const { pin } = useAdmin();
  const { data, loading, error, reload } = useAdminData(
    (p) => adminClosures({ data: { pin: p } }),
    [],
  );
  const today = salonToday();
  const [kind, setKind] = useState<Kind>("days");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [dates, setDates] = useState<string[]>([]);
  const [pick, setPick] = useState(today);
  const [from, setFrom] = useState(15 * 60);
  const [to, setTo] = useState(18 * 60);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  /** The closure being edited (its earliest allowed start: today, or its own start if it began already). */
  const [editing, setEditing] = useState<{ id: string; minStart: string } | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  type Closure = NonNullable<typeof data>["closures"][number];
  const startEdit = (c: Closure) => {
    const hours = c.startMinute != null && c.endMinute != null;
    setKind(hours ? "hours" : c.end === null ? "open" : "days");
    setStart(c.start);
    setEnd(c.end ?? c.start);
    if (hours) {
      setFrom(c.startMinute!);
      setTo(c.endMinute!);
    }
    setReason(c.reason);
    setConfirmId(null);
    setEditing({ id: c.id, minStart: c.start < today ? c.start : today });
    window.requestAnimationFrame(() =>
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };
  const stopEdit = () => {
    setEditing(null);
    setKind("days");
    setStart(today);
    setEnd(today);
    setReason("");
  };
  const saveEdit = async () => {
    if (!editing || kind === "dates") return;
    setBusy(true);
    try {
      const r = await adminUpdateClosure({
        data: {
          pin,
          id: editing.id,
          kind,
          start,
          reason: reason.trim(),
          ...(kind === "days" ? { end } : {}),
          ...(kind === "hours" ? { startMinute: from, endMinute: to } : {}),
        },
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Closure updated.");
      stopEdit();
      reload();
    } catch {
      toast.error("Couldn't save the changes.");
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    setBusy(true);
    try {
      const r = await adminAddClosure({
        data: {
          pin,
          kind,
          reason: reason.trim(),
          ...(kind === "dates" ? { dates } : { start }),
          ...(kind === "days" ? { end } : {}),
          ...(kind === "hours" ? { startMinute: from, endMinute: to } : {}),
        },
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Salon closure saved. Guests can't book those times.");
      setDates([]);
      setReason("");
      reload();
    } catch {
      toast.error("Couldn't save the closure.");
    } finally {
      setBusy(false);
    }
  };
  const reopen = async (id: string) => {
    const r = await adminReopen({ data: { pin, id } }).catch(() => null);
    setConfirmId(null);
    if (!r?.ok) return void toast.error("Couldn't reopen.");
    toast.success("Salon reopened.");
    reload();
  };

  const field = "rounded-md border border-foreground/15 bg-background px-3 py-2 text-[0.9rem]";
  return (
    <AdminShell
      title="Salon closures"
      subtitle="Closing the salon blocks everything. For one stylist's time off, use Staff."
    >
      <LoadState loading={loading && !data} error={error} onRetry={reload} />
      {data && !data.available ? (
        <Empty title="Closures appear once the latest database update (0008) has been applied." />
      ) : null}
      {data?.available ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Panel>
            <div ref={formRef} className="scroll-mt-24" />
            <h2 className="font-display text-[1.35rem]">
              {editing ? "Edit closure" : "Close the salon"}
            </h2>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {KINDS.filter((k) => !editing || k.key !== "dates").map((k) => (
                <button
                  key={k.key}
                  onClick={() => setKind(k.key)}
                  className={cn(
                    "press rounded-full border px-3 py-1 text-[0.8rem]",
                    kind === k.key
                      ? "border-foreground bg-foreground text-background"
                      : "border-foreground/15",
                  )}
                >
                  {k.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[0.78rem] text-muted-foreground">
              {KINDS.find((k) => k.key === kind)!.hint}
            </p>

            <div className="mt-4 space-y-3">
              {kind === "dates" ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="date"
                      value={pick}
                      min={today}
                      onChange={(e) => setPick(e.target.value)}
                      className={field}
                      aria-label="Date to add"
                    />
                    <TinyButton
                      onClick={() => pick && setDates((d) => [...new Set([...d, pick])].sort())}
                    >
                      <Plus className="h-3.5 w-3.5" /> Add date
                    </TinyButton>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {dates.map((d) => (
                      <span
                        key={d}
                        className="inline-flex items-center gap-1 rounded-full border border-foreground/15 px-2.5 py-0.5 text-[0.8rem]"
                      >
                        {nice(d)}
                        <button
                          aria-label={`Remove ${d}`}
                          onClick={() => setDates((x) => x.filter((y) => y !== d))}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                    {!dates.length ? (
                      <span className="text-[0.8rem] text-muted-foreground">
                        No dates added yet.
                      </span>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={start}
                    min={editing?.minStart ?? today}
                    onChange={(e) => {
                      setStart(e.target.value);
                      if (e.target.value > end) setEnd(e.target.value);
                    }}
                    className={field}
                    aria-label={kind === "open" ? "Closed from" : "Date"}
                  />
                  {kind === "days" ? (
                    <>
                      <span className="text-muted-foreground">→</span>
                      <input
                        type="date"
                        value={end}
                        min={start}
                        onChange={(e) => setEnd(e.target.value)}
                        className={field}
                        aria-label="Until"
                      />
                    </>
                  ) : null}
                  {kind === "hours" ? (
                    <>
                      <select
                        value={from}
                        onChange={(e) => setFrom(Number(e.target.value))}
                        className={field}
                        aria-label="From"
                      >
                        {TIMES.map((t) => (
                          <option key={t} value={t}>
                            {minuteLabel(t)}
                          </option>
                        ))}
                      </select>
                      <span className="text-muted-foreground">–</span>
                      <select
                        value={to}
                        onChange={(e) => setTo(Number(e.target.value))}
                        className={field}
                        aria-label="Until"
                      >
                        {TIMES.map((t) => (
                          <option key={t} value={t}>
                            {minuteLabel(t)}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : null}
                  {kind === "open" ? (
                    <span className="text-[0.85rem] text-muted-foreground">until you reopen</span>
                  ) : null}
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                {REASONS.map((r) => (
                  <button
                    key={r}
                    onClick={() => setReason(r)}
                    className={cn(
                      "press rounded-full border px-3 py-0.5 text-[0.78rem]",
                      reason === r
                        ? "border-foreground bg-foreground text-background"
                        : "border-foreground/15",
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason (shown to guests)"
                maxLength={120}
                className={cn(field, "w-full")}
              />
              {editing ? (
                <div className="flex flex-wrap gap-2">
                  <TinyButton tone="primary" disabled={busy} onClick={() => void saveEdit()}>
                    {busy ? "Saving…" : "Save changes"}
                  </TinyButton>
                  <TinyButton disabled={busy} onClick={stopEdit}>
                    Cancel
                  </TinyButton>
                </div>
              ) : (
                <TinyButton
                  tone="danger"
                  disabled={busy || (kind === "dates" && !dates.length)}
                  onClick={() => void add()}
                >
                  {busy ? "Saving…" : "Close the salon"}
                </TinyButton>
              )}
              <p className="text-[0.75rem] text-muted-foreground">
                Guests see "Salon is closed on this date." Existing appointments stay booked and
                visible here and in the calendar — contact or move them.
              </p>
            </div>
          </Panel>

          <Panel>
            <h2 className="font-display text-[1.35rem]">Current and upcoming</h2>
            <ul className="mt-3 divide-y divide-hairline">
              {data.closures.map((c) => (
                <li
                  key={c.id}
                  className={cn(
                    "py-3",
                    editing?.id === c.id && "-mx-2 rounded-md bg-foreground/[0.04] px-2",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[0.95rem]">
                        {c.startMinute != null && c.endMinute != null
                          ? `${nice(c.start)} · ${minuteLabel(c.startMinute)}–${minuteLabel(c.endMinute)}`
                          : c.end === null
                            ? `From ${nice(c.start)} · until further notice`
                            : c.end === c.start
                              ? nice(c.start)
                              : `${nice(c.start)} → ${nice(c.end)}`}
                      </div>
                      <div className="text-[0.8rem] text-muted-foreground">
                        {c.status === "active" ? "Closed now" : "Upcoming"}
                        {c.reason ? ` · ${c.reason}` : ""}
                        {c.bookings
                          ? ` · ${c.bookings} booking${c.bookings > 1 ? "s" : ""} inside`
                          : ""}
                      </div>
                    </div>
                    {confirmId === c.id ? (
                      <div className="flex shrink-0 gap-1.5">
                        <TinyButton tone="primary" onClick={() => void reopen(c.id)}>
                          Reopen
                        </TinyButton>
                        <TinyButton onClick={() => setConfirmId(null)}>Keep</TinyButton>
                      </div>
                    ) : (
                      <div className="flex shrink-0 gap-1.5">
                        <TinyButton onClick={() => startEdit(c)}>
                          {editing?.id === c.id ? "Editing…" : "Edit"}
                        </TinyButton>
                        <TinyButton onClick={() => setConfirmId(c.id)}>Reopen</TinyButton>
                      </div>
                    )}
                  </div>
                </li>
              ))}
              {!data.closures.length ? (
                <li className="py-6 text-center text-[0.85rem] text-muted-foreground">
                  The salon has no closures planned.
                </li>
              ) : null}
            </ul>
          </Panel>
        </div>
      ) : null}
    </AdminShell>
  );
}
