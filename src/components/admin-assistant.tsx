import { useEffect, useRef, useState } from "react";
import { Check, Mic, MessageSquareText, Send, X } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useAdmin, STATUS_LABEL } from "@/lib/admin-store";
import { menuFor, minuteLabel } from "@/lib/salon";
import {
  adminAvailability,
  adminBooking,
  adminDay,
  adminRange,
  type AdminBooking,
} from "@/lib/admin-data.functions";
import { adminUpsertBooking } from "@/lib/salon.functions";
import { adminSaveBlock } from "@/lib/admin-ops.functions";
import { adminAddClosure } from "@/lib/admin-staff.functions";
import {
  addDays,
  HELP_LINES,
  nameMatches,
  parseCommand,
  type Intent,
  type Who,
} from "@/lib/assistant";
import { cn } from "@/lib/utils";

/* Admin assistant: type (or dictate) a command; changes always wait for Confirm. */

type Choice = { label: string; intent: Intent };
type Plan = {
  title: string;
  lines: [string, string][];
  confirm: string;
  run: () => Promise<string>;
  state: "waiting" | "running" | "done" | "cancelled" | "error";
  result?: string;
};
type Msg = {
  id: number;
  from: "me" | "bot";
  text: string;
  list?: string[];
  choices?: Choice[];
  plan?: Plan;
};

const salonToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const live = (b: AdminBooking) => b.status !== "cancelled" && b.status !== "no-show";
const short = (b: AdminBooking) =>
  `${minuteLabel(b.time)} · ${b.customer.name} · ${b.services.map((s) => s.name).join(", ")}${b.staffName ? ` · ${b.staffName}` : ""} · ${STATUS_LABEL[b.status]}`;
const errText = (e: unknown) =>
  e instanceof Error && e.message.length < 160 ? e.message : "Couldn't do that. Please try again.";

const SUGGEST = ["Today", "Tomorrow", "Free slots today", "Earnings this week", "Help"];

type SpeechRec = {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};
const speechCtor = (): (new () => SpeechRec) | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRec;
    webkitSpeechRecognition?: new () => SpeechRec;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export function AdminAssistant() {
  const { pin, refresh } = useAdmin();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      id: 0,
      from: "bot",
      text: "Hi! Tell me what to do, e.g. “today”, “book Ravi 9876543210 haircut tomorrow 4 pm” or “Ravi arrived”. I'll always ask before changing anything.",
    },
  ]);
  const nextId = useRef(1);
  const end = useRef<HTMLDivElement>(null);
  const rec = useRef<SpeechRec | null>(null);
  const canListen = typeof window !== "undefined" && Boolean(speechCtor());

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, open]);

  const push = (m: Omit<Msg, "id">) => setMsgs((xs) => [...xs, { ...m, id: nextId.current++ }]);
  const setPlan = (id: number, p: Partial<Plan>) =>
    setMsgs((xs) =>
      xs.map((m) => (m.id === id && m.plan ? { ...m, plan: { ...m.plan, ...p } } : m)),
    );

  /* ── lookups ─────────────────────────────────────────────── */

  /** The booking a command points at (by ID, or by name, date and time). */
  const resolve = async (
    who: Who,
    intent: Intent,
    opts: { todayOnly?: boolean } = {},
  ): Promise<AdminBooking | null> => {
    if (who.ref) {
      const r = await adminBooking({ data: { pin, reference: who.ref } });
      if (!r.booking) {
        push({ from: "bot", text: `I couldn't find booking ${who.ref}.` });
        return null;
      }
      return r.booking;
    }
    if (!who.name) {
      push({ from: "bot", text: "Whose booking? Add their name or booking ID (e.g. HB-7KQ2MX)." });
      return null;
    }
    const today = salonToday();
    const from = who.date ?? (opts.todayOnly ? today : today);
    const to = who.date ?? (opts.todayOnly ? today : addDays(today, 30));
    const r = await adminRange({ data: { pin, from, to } });
    const hits = r.bookings.filter(
      (b) =>
        b.status !== "cancelled" &&
        nameMatches(who.name!, b.customer.name) &&
        (who.time == null || b.time === who.time),
    );
    if (!hits.length) {
      const when = who.date
        ? ` on ${dayLabel(who.date)}`
        : opts.todayOnly
          ? " today"
          : " in the next 30 days";
      push({ from: "bot", text: `I couldn't find a booking for ${who.name}${when}.` });
      return null;
    }
    if (hits.length > 1) {
      push({
        from: "bot",
        text: `${hits.length} bookings match “${who.name}”. Which one?`,
        choices: hits.slice(0, 8).map((b) => ({
          label: `${dayLabel(b.date)} ${minuteLabel(b.time)} · ${b.customer.name} · ${b.reference}`,
          intent: { ...intent, who: { ref: b.reference } } as Intent,
        })),
      });
      return null;
    }
    return hits[0]!;
  };

  /** Free start times on a day; offers the nearest ones when the asked time is taken. */
  const freeTimes = async (
    date: string,
    audience: "men" | "women",
    serviceIds: string[],
    reference?: string,
  ) => {
    const r = await adminAvailability({
      data: { pin, date, audience, serviceIds, ...(reference ? { reference } : {}) },
    });
    const slots =
      (r as { slots: { minute: number; available: boolean }[]; closed?: boolean; message?: string })
        .slots ?? [];
    return {
      free: slots.filter((s) => s.available).map((s) => s.minute),
      closed: Boolean((r as { closed?: boolean }).closed),
      message: (r as { message?: string }).message ?? "",
    };
  };
  const nearest = (free: number[], want: number) =>
    [...free]
      .sort((a, b) => Math.abs(a - want) - Math.abs(b - want))
      .slice(0, 6)
      .sort((a, b) => a - b);

  const confirmCard = (plan: Omit<Plan, "state">) =>
    push({ from: "bot", text: "", plan: { ...plan, state: "waiting" } });

  /* ── one command ─────────────────────────────────────────── */

  const handle = async (intent: Intent) => {
    const today = salonToday();
    switch (intent.kind) {
      case "help":
        return push({ from: "bot", text: "Things you can say:", list: HELP_LINES });

      case "unknown":
        return push({
          from: "bot",
          text: "Sorry, I didn't get that. Try one of these:",
          list: HELP_LINES.slice(0, 6),
        });

      case "day": {
        const r = await adminDay({ data: { pin, date: intent.date } });
        const list = r.bookings.filter(live);
        const value = list.reduce((n, b) => n + b.price, 0);
        const blocks = r.blocks.map(
          (b) =>
            `${minuteLabel(b.start)}–${minuteLabel(b.end)} ${b.reason || (b.kind === "break" ? "Break" : "Blocked")}`,
        );
        return push({
          from: "bot",
          text: r.plan.closed
            ? `${dayLabel(intent.date)}: the salon is closed.`
            : list.length
              ? `${dayLabel(intent.date)}: ${list.length} booking${list.length === 1 ? "" : "s"} · ${inr(value)}`
              : `${dayLabel(intent.date)}: no bookings yet.`,
          list: [...list.map(short), ...blocks.map((x) => `⛔ ${x}`)],
        });
      }

      case "at": {
        const r = await adminDay({ data: { pin, date: intent.date } });
        const list = r.bookings.filter(
          (b) => live(b) && b.time <= intent.time && intent.time < b.end,
        );
        return push({
          from: "bot",
          text: list.length
            ? `At ${minuteLabel(intent.time)} on ${dayLabel(intent.date)}:`
            : `Nobody is booked at ${minuteLabel(intent.time)} on ${dayLabel(intent.date)}.`,
          list: list.map(short),
        });
      }

      case "summary": {
        const { from, to, label } = intent.range;
        const r = await adminRange({ data: { pin, from, to } });
        const all = r.bookings;
        const active = all.filter(live);
        const done = all.filter((b) => b.status === "completed");
        const earned = done.reduce((n, b) => n + (b.amountPaid ?? b.price), 0);
        return push({
          from: "bot",
          text: `${label[0]!.toUpperCase()}${label.slice(1)}${from !== to ? ` (${dayLabel(from)} – ${dayLabel(to)})` : label === "today" ? "" : ""}:`,
          list: [
            `${active.length} booking${active.length === 1 ? "" : "s"} worth ${inr(active.reduce((n, b) => n + b.price, 0))}`,
            `${done.length} completed · ${inr(earned)} earned`,
            `${all.filter((b) => b.status === "cancelled").length} cancelled · ${all.filter((b) => b.status === "no-show").length} no-show`,
          ],
        });
      }

      case "free": {
        const f = await freeTimes(intent.date, intent.audience, intent.serviceIds);
        if (f.closed)
          return push({ from: "bot", text: `The salon is closed on ${dayLabel(intent.date)}.` });
        return push({
          from: "bot",
          text: f.free.length
            ? `Free on ${dayLabel(intent.date)}${intent.serviceIds.length ? " for that service" : ""}:`
            : f.message || `No free times on ${dayLabel(intent.date)}.`,
          list: f.free.length ? [f.free.map(minuteLabel).join(" · ")] : [],
        });
      }

      case "find": {
        if (/^HB-/i.test(intent.name)) {
          const r = await adminBooking({ data: { pin, reference: intent.name.toUpperCase() } });
          if (!r.booking) return push({ from: "bot", text: `I couldn't find ${intent.name}.` });
          const b = r.booking;
          return push({
            from: "bot",
            text: `${b.reference} · ${dayLabel(b.date)}`,
            list: [short(b), `Phone ${b.customer.phone}`],
          });
        }
        const r = await adminRange({
          data: { pin, from: addDays(today, -30), to: addDays(today, 60) },
        });
        const hits = r.bookings.filter((b) => nameMatches(intent.name, b.customer.name));
        if (!hits.length)
          return push({
            from: "bot",
            text: `No bookings for “${intent.name}” in the last 30 or next 60 days.`,
          });
        const up = hits.filter((b) => b.date >= today && b.status !== "cancelled");
        return push({
          from: "bot",
          text: up.length
            ? `Upcoming for “${intent.name}”:`
            : `No upcoming booking for “${intent.name}”. Recent:`,
          list: (up.length ? up : hits.slice(-5)).map(
            (b) => `${dayLabel(b.date)} ${short(b)} · ${b.reference}`,
          ),
        });
      }

      case "book": {
        const missing = [
          !intent.name && "the customer's name",
          intent.phone.length !== 10 && "a 10-digit phone number",
          !intent.serviceIds.length && "the service",
          intent.time == null && "the time",
        ].filter(Boolean) as string[];
        if (missing.length)
          return push({
            from: "bot",
            text: `To book I also need ${missing.join(", ")}. For example: “book Ravi 9876543210 haircut tomorrow 4 pm”.`,
          });
        const date = intent.date ?? today;
        const services = menuFor(intent.audience)
          .flatMap((c) => c.services)
          .filter((s) => intent.serviceIds.includes(s.id));
        const f = await freeTimes(date, intent.audience, intent.serviceIds);
        if (!f.free.includes(intent.time!)) {
          const near = nearest(f.free, intent.time!);
          return push({
            from: "bot",
            text: f.closed
              ? `The salon is closed on ${dayLabel(date)}.`
              : !near.length && f.message
                ? f.message
                : `${minuteLabel(intent.time!)} on ${dayLabel(date)} isn't free.${near.length ? " Nearest free times:" : " No free times that day."}`,
            choices: near.map((m) => ({
              label: minuteLabel(m),
              intent: { ...intent, date, time: m },
            })),
          });
        }
        const total = services.reduce((n, s) => n + s.price, 0);
        return confirmCard({
          title: "New booking",
          lines: [
            ["Customer", `${intent.name} · ${intent.phone}`],
            ["Services", `${services.map((s) => s.name).join(", ")} (${intent.audience})`],
            ["When", `${dayLabel(date)}, ${minuteLabel(intent.time!)}`],
            ["Total", inr(total)],
          ],
          confirm: "Book it",
          run: async () => {
            const r = (await adminUpsertBooking({
              data: {
                pin,
                reference: "new",
                insert: {
                  audience: intent.audience,
                  serviceIds: intent.serviceIds,
                  date,
                  time: intent.time!,
                  customer: { name: intent.name, phone: intent.phone, email: "" },
                  source: date === today ? "walk-in" : "phone",
                },
              },
            })) as { reference?: string };
            return `Booked ${intent.name} for ${dayLabel(date)}, ${minuteLabel(intent.time!)}${r.reference ? ` (${r.reference})` : ""}.`;
          },
        });
      }

      case "move": {
        const b = await resolve(intent.who, intent);
        if (!b) return;
        const date = intent.date ?? b.date;
        const time = intent.time ?? b.time;
        if (date === b.date && time === b.time)
          return push({
            from: "bot",
            text: `Where to? e.g. “move ${b.customer.name.split(" ")[0]} to 5 pm” or “… to 14 Nov 11 am”.`,
          });
        const f = await freeTimes(date, b.audience, b.serviceIds, b.reference);
        if (!f.free.includes(time)) {
          const near = nearest(f.free, time);
          return push({
            from: "bot",
            text: f.closed
              ? `The salon is closed on ${dayLabel(date)}.`
              : !near.length && f.message
                ? f.message
                : `${minuteLabel(time)} on ${dayLabel(date)} isn't free for ${b.customer.name}.${near.length ? " Nearest free times:" : " No free times that day."}`,
            choices: near.map((m) => ({
              label: minuteLabel(m),
              intent: { kind: "move", who: { ref: b.reference }, date, time: m },
            })),
          });
        }
        return confirmCard({
          title: "Move booking",
          lines: [
            ["Customer", `${b.customer.name} · ${b.reference}`],
            ["From", `${dayLabel(b.date)}, ${minuteLabel(b.time)}`],
            ["To", `${dayLabel(date)}, ${minuteLabel(time)}`],
          ],
          confirm: "Move it",
          run: async () => {
            await adminUpsertBooking({
              data: { pin, reference: b.reference, patch: { date, time } },
            });
            return `Moved ${b.customer.name} to ${dayLabel(date)}, ${minuteLabel(time)}.`;
          },
        });
      }

      case "cancel": {
        const b = await resolve(intent.who, intent);
        if (!b) return;
        return confirmCard({
          title: "Cancel booking",
          lines: [
            ["Customer", `${b.customer.name} · ${b.reference}`],
            [
              "Booking",
              `${dayLabel(b.date)}, ${minuteLabel(b.time)} · ${b.services.map((s) => s.name).join(", ")}`,
            ],
            ...(intent.reason ? ([["Reason", intent.reason]] as [string, string][]) : []),
          ],
          confirm: "Cancel booking",
          run: async () => {
            await adminUpsertBooking({
              data: {
                pin,
                reference: b.reference,
                patch: {
                  status: "cancelled",
                  meta: { status: "cancelled" },
                  cancelReason: intent.reason || "Cancelled by the salon",
                },
              },
            });
            return `Cancelled ${b.customer.name}'s ${minuteLabel(b.time)} booking on ${dayLabel(b.date)}.`;
          },
        });
      }

      case "status": {
        const b = await resolve(intent.who, intent, {
          todayOnly: !intent.who.date && !intent.who.ref,
        });
        if (!b) return;
        if (b.status === intent.status)
          return push({
            from: "bot",
            text: `${b.customer.name} is already “${STATUS_LABEL[intent.status]}”.`,
          });
        return confirmCard({
          title: "Update status",
          lines: [
            ["Customer", `${b.customer.name} · ${minuteLabel(b.time)}, ${dayLabel(b.date)}`],
            ["Status", `${STATUS_LABEL[b.status]} → ${STATUS_LABEL[intent.status]}`],
          ],
          confirm: `Mark ${STATUS_LABEL[intent.status].toLowerCase()}`,
          run: async () => {
            await adminUpsertBooking({
              data: { pin, reference: b.reference, patch: { meta: { status: intent.status } } },
            });
            return `${b.customer.name}: ${STATUS_LABEL[intent.status]}.`;
          },
        });
      }

      case "block": {
        const kind = /break|lunch/i.test(intent.reason) ? "break" : "block";
        const save = async (confirm: boolean) =>
          adminSaveBlock({
            data: {
              pin,
              date: intent.date,
              start: intent.start,
              end: intent.end,
              kind,
              reason: intent.reason,
              confirm,
            },
          });
        return confirmCard({
          title: kind === "break" ? "Add a break" : "Block time",
          lines: [
            [
              "When",
              `${dayLabel(intent.date)}, ${minuteLabel(intent.start)} – ${minuteLabel(intent.end)}`,
            ],
            ["Reason", intent.reason],
          ],
          confirm: kind === "break" ? "Add break" : "Block it",
          run: async () => {
            const r = (await save(false)) as {
              ok: boolean;
              clashes?: { time: number; name: string }[];
              error?: string;
            };
            if (!r.ok && r.clashes?.length) {
              // bookings already sit in that time: show them and ask again
              confirmCard({
                title: "Block anyway?",
                lines: r.clashes.map(
                  (c) => ["Booked", `${minuteLabel(c.time)} · ${c.name}`] as [string, string],
                ),
                confirm: "Block anyway",
                run: async () => {
                  const again = (await save(true)) as { ok: boolean; error?: string };
                  if (!again.ok) throw new Error(again.error ?? "Couldn't save.");
                  return "Blocked. The existing bookings are kept; move or cancel them if needed.";
                },
              });
              return "That time has bookings. Check them below before blocking.";
            }
            if (!r.ok) throw new Error(r.error ?? "Couldn't save.");
            return `Blocked ${minuteLabel(intent.start)} – ${minuteLabel(intent.end)} on ${dayLabel(intent.date)}.`;
          },
        });
      }

      case "close": {
        const past = intent.dates.filter((d) => d < today);
        if (past.length)
          return push({
            from: "bot",
            text: `${past.map(dayLabel).join(", ")} has already passed.`,
          });
        const r = await adminRange({
          data: { pin, from: intent.dates[0]!, to: intent.dates[intent.dates.length - 1]! },
        });
        const affected = r.bookings.filter((b) => live(b) && intent.dates.includes(b.date));
        return confirmCard({
          title: "Close the salon",
          lines: [
            ["Dates", intent.dates.map(dayLabel).join(", ")],
            ["Reason", intent.reason],
            ...(affected.length
              ? ([
                  [
                    "Note",
                    `${affected.length} booking${affected.length === 1 ? "" : "s"} on ${affected.length === 1 ? "that day stays" : "those days stay"}; move or cancel them`,
                  ],
                ] as [string, string][])
              : []),
          ],
          confirm: "Close salon",
          run: async () => {
            const res = (await adminAddClosure({
              data: { pin, kind: "dates", dates: intent.dates, reason: intent.reason },
            })) as { ok: boolean; error?: string };
            if (!res.ok) throw new Error(res.error ?? "Couldn't save the closure.");
            return `Closed on ${intent.dates.map(dayLabel).join(", ")}.`;
          },
        });
      }
    }
  };

  const ask = async (raw: string, intent?: Intent) => {
    const t = raw.trim();
    if (!t || busy) return;
    push({ from: "me", text: t });
    setText("");
    setBusy(true);
    try {
      await handle(
        intent ??
          parseCommand(t, {
            today: salonToday(),
            menus: { men: menuFor("men"), women: menuFor("women") },
          }),
      );
    } catch (e) {
      push({ from: "bot", text: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  const runPlan = async (id: number, plan: Plan) => {
    setPlan(id, { state: "running" });
    try {
      const msg = await plan.run();
      setPlan(id, { state: "done", result: msg });
      refresh();
      window.dispatchEvent(new Event("hb-admin-changed"));
    } catch (e) {
      setPlan(id, { state: "error", result: errText(e) });
    }
  };

  const listen = () => {
    const C = speechCtor();
    if (!C) return;
    if (listening) return rec.current?.stop();
    const r = new C();
    r.lang = "en-IN";
    r.interimResults = false;
    r.onresult = (e) => {
      const said = Array.from(e.results)
        .map((x) => x[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (said) void ask(said);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open the assistant"
        className="press fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 flex h-12 items-center gap-2 rounded-full bg-ink px-4 text-[0.8rem] tracking-wide text-ivory shadow-[0_14px_30px_-12px_rgba(0,0,0,0.55)] md:bottom-6 md:right-6"
      >
        <MessageSquareText className="h-4 w-4" strokeWidth={1.5} />
        Assistant
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[28rem]">
          <div className="border-b border-hairline px-5 pt-5 pb-4">
            <div className="eyebrow">Console</div>
            <SheetTitle className="mt-1 font-display text-2xl font-normal">Assistant</SheetTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Reads your real bookings. Asks before changing anything.
            </p>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {msgs.map((m) => (
              <div
                key={m.id}
                className={cn("flex", m.from === "me" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[92%] rounded-2xl px-3.5 py-2.5 text-[0.86rem] leading-relaxed",
                    m.from === "me"
                      ? "bg-ink text-ivory"
                      : m.plan
                        ? "w-full bg-transparent p-0"
                        : "bg-muted text-foreground",
                  )}
                >
                  {m.text ? <p>{m.text}</p> : null}
                  {m.list?.length ? (
                    <ul className="mt-1.5 space-y-1 text-[0.8rem] text-foreground/80">
                      {m.list.map((l, i) => (
                        <li key={i} className="border-l-2 border-bronze/40 pl-2">
                          {l}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {m.choices?.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {m.choices.map((c, i) => (
                        <button
                          key={i}
                          type="button"
                          disabled={busy}
                          onClick={() => void ask(c.label, c.intent)}
                          className="press rounded-full border border-hairline bg-background px-3 py-1.5 text-[0.76rem] hover:border-bronze"
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {m.plan ? (
                    <PlanCard
                      plan={m.plan}
                      onRun={() => void runPlan(m.id, m.plan!)}
                      onCancel={() => setPlan(m.id, { state: "cancelled" })}
                    />
                  ) : null}
                </div>
              </div>
            ))}
            {busy ? <div className="text-xs text-muted-foreground">Checking…</div> : null}
            <div ref={end} />
          </div>

          <div className="border-t border-hairline px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <div className="mb-2 flex gap-1.5 overflow-x-auto">
              {SUGGEST.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={busy}
                  onClick={() => void ask(s)}
                  className="press shrink-0 rounded-full border border-hairline px-3 py-1 text-[0.74rem] text-muted-foreground hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void ask(text);
              }}
            >
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={listening ? "Listening…" : "Type a command…"}
                aria-label="Command"
                className="h-11 min-w-0 flex-1 rounded-full border border-hairline bg-background px-4 text-[0.9rem] outline-none focus:border-bronze"
              />
              {canListen ? (
                <button
                  type="button"
                  onClick={listen}
                  aria-label={listening ? "Stop listening" : "Speak a command"}
                  className={cn(
                    "press flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-hairline",
                    listening && "border-bronze bg-bronze text-ivory",
                  )}
                >
                  <Mic className="h-4 w-4" strokeWidth={1.5} />
                </button>
              ) : null}
              <button
                type="submit"
                disabled={busy || !text.trim()}
                aria-label="Send"
                className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink text-ivory disabled:opacity-40"
              >
                <Send className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </form>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function PlanCard({
  plan,
  onRun,
  onCancel,
}: {
  plan: Plan;
  onRun: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-2xl border border-bronze/40 bg-background p-4 shadow-sm">
      <div className="eyebrow text-bronze">Please confirm</div>
      <div className="mt-1 font-display text-lg">{plan.title}</div>
      <dl className="mt-2 space-y-1 text-[0.82rem]">
        {plan.lines.map(([k, v], i) => (
          <div key={i} className="flex gap-3">
            <dt className="w-20 shrink-0 text-muted-foreground">{k}</dt>
            <dd className="text-foreground">{v}</dd>
          </div>
        ))}
      </dl>
      {plan.state === "waiting" || plan.state === "running" ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={plan.state === "running"}
            onClick={onRun}
            className="press flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full bg-ink text-[0.8rem] text-ivory disabled:opacity-50"
          >
            <Check className="h-4 w-4" /> {plan.state === "running" ? "Saving…" : plan.confirm}
          </button>
          <button
            type="button"
            disabled={plan.state === "running"}
            onClick={onCancel}
            className="press flex h-10 items-center justify-center gap-1 rounded-full border border-hairline px-4 text-[0.8rem]"
          >
            <X className="h-4 w-4" /> No
          </button>
        </div>
      ) : (
        <p
          className={cn(
            "mt-3 text-[0.82rem]",
            plan.state === "done"
              ? "text-foreground"
              : plan.state === "error"
                ? "text-destructive"
                : "text-muted-foreground",
          )}
        >
          {plan.state === "cancelled" ? "Okay, nothing changed." : plan.result}
        </p>
      )}
    </div>
  );
}
