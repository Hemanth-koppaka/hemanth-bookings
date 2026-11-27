/**
 * Admin assistant planner (free, no AI service).
 *
 * Turns a resolved intent into a reply: look-ups run straight away through the
 * allowlisted read tools; every change is only PREPARED through the existing
 * one-time confirmation ledger (preview → Confirm → re-check → save), exactly
 * like before. Nothing here writes to the database directly.
 */
import { assertAdmin } from "./admin-auth.server";
import { assistantTools } from "./admin-assistant-tools.server";
import {
  safeAssistantArguments,
  type AssistantAction,
  type AssistantReply,
  type AssistantView,
  type Json,
} from "./admin-assistant-policy";
import { baseline, ensureNoClashes, ownerHash, proposal, sameData } from "./admin-assistant.server";
import type { Memory, Ref, Resolved, Staff } from "./assistant-intents";

const STATUS: Record<string, string> = {
  pending: "Pending",
  upcoming: "Confirmed",
  arrived: "Checked in",
  "in-chair": "In service",
  completed: "Completed",
  "no-show": "No show",
  cancelled: "Cancelled",
};
type Bk = {
  reference: string;
  bookingNo: number | null;
  date: string;
  time: number;
  end: number;
  status: string;
  price: number;
  amountPaid: number | null;
  audience: "men" | "women";
  serviceIds: string[];
  services: { name: string }[];
  customer: { name: string; phone: string };
  staffId: string | null;
  staffName: string;
};
type StaffRow = Staff & {
  active?: boolean;
  hours: { day: number; working: boolean; start: number; end: number }[];
  breaks: { id: string; day: number | null; start: number; end: number; label: string }[];
  leave: { id: string; start: string; end: string; reason: string }[];
  blocks: { id: string; date: string; start: number; end: number; reason: string }[];
};
type Block = { id: string; date: string; start: number; end: number; kind: string; reason: string };
type Closure = {
  id: string;
  start: string;
  end: string | null;
  startMinute: number | null;
  endMinute: number | null;
  reason: string;
};
type Svc = {
  id: string;
  gender: string;
  categoryId: string;
  name: string;
  description: string;
  minutes: number;
  buffer: number;
  price: number;
  from: boolean;
  featured: boolean;
  order: number;
  active: boolean;
  archived: boolean;
};

const object = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const dayText = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const live = (b: Bk) => b.status !== "cancelled" && b.status !== "no-show";
const dowOf = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const overlaps = (a: number, b: number, c: number, d: number) => a < d && c < b;
const rangeText = (r: { from: string; to: string; label: string }, today: string) =>
  r.from === r.to
    ? r.from === today
      ? "today"
      : `on ${dayText(r.from)}`
    : /^(this|next|the) /.test(r.label)
      ? r.label
      : `${dayText(r.from)} – ${dayText(r.to)}`;

/** Memory travels through the client; keep only well-formed, small values. */
function readMemory(v: unknown): Memory {
  const m = object(v);
  const out: Memory = {};
  const st = object(m["staff"]);
  if (typeof st["id"] === "string" && typeof st["name"] === "string")
    out.staff = { id: st["id"], name: st["name"] };
  if (typeof m["date"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(m["date"])) out.date = m["date"];
  if (Array.isArray(m["list"]))
    out.list = m["list"]
      .slice(0, 20)
      .map(object)
      .filter(
        (r) =>
          typeof r["id"] === "string" &&
          ["block", "staffBlock", "leave", "closure", "booking"].includes(String(r["type"])),
      )
      .map((r) => ({
        type: r["type"] as Ref["type"],
        id: String(r["id"]),
        label: String(r["label"] ?? ""),
        ...(typeof r["staffId"] === "string" ? { staffId: r["staffId"] } : {}),
      }));
  if (m["last"] && typeof m["last"] === "object" && typeof object(m["last"])["kind"] === "string")
    out.last = m["last"] as Resolved;
  if (m["awaiting"] === "staffHours") out.awaiting = "staffHours";
  return out;
}

export async function planReply(
  pin: string,
  conversationId: string,
  userText: string,
  rawMemory: unknown,
): Promise<AssistantReply> {
  const { resolve } = await import("./assistant-intents");
  const C = await import("./assistant-commands");
  const { minuteLabel, menuFor } = await import("./salon");
  await (await import("./bookings.server")).engine();
  const tools = assistantTools();
  const read = async <T>(name: string, input: Record<string, unknown>) => {
    const tool = tools.find((t) => t.name === name && t.read);
    if (!tool) throw new Error("That look-up is not available.");
    return (await tool.execute(pin, input)) as T;
  };
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const memory = readMemory(rawMemory);
  const staffRows = (
    (await read<{ staff?: StaffRow[] }>("adminStaffList", {}).catch(() => ({ staff: [] }))).staff ??
    []
  ).filter((s) => s.active !== false);
  const staffList: Staff[] = staffRows.map((s) => ({ id: s.id, name: s.name }));
  const intent = resolve(userText, {
    today,
    menus: { men: menuFor("men"), women: menuFor("women") },
    staff: staffList,
    memory,
  });
  const ml = minuteLabel;
  const bLine = (b: Bk) =>
    `${ml(b.time)} · ${b.customer.name} · ${b.services.map((s) => s.name).join(", ")}${b.staffName ? ` · ${b.staffName}` : ""} · ${STATUS[b.status] ?? b.status}`;
  // what the next message can refer back to
  const next: Memory = { ...memory };
  delete next.last;
  delete next.awaiting;
  const reply = (text: string, extra: Partial<AssistantReply> = {}): AssistantReply => ({
    text,
    context: JSON.parse(JSON.stringify(next)) as Json,
    ...extra,
  });
  const remember = (patch: Partial<Record<keyof Memory, unknown>>) => {
    for (const [k, v] of Object.entries(patch))
      if (v !== undefined) (next as Record<string, unknown>)[k] = v;
  };
  const go = (
    label: string,
    page: string,
    search?: { date?: string; id?: string },
  ): AssistantAction => ({
    label,
    to: `/admin${page ? `/${page}` : ""}` as AssistantAction["to"],
    ...(search ? { search } : {}),
  });
  const calendarAt = (date?: string | null) =>
    go("View in Calendar", "calendar", date ? { date } : undefined);

  /** Prepare a change: allowlisted tool, clash guard, baseline, one pending proposal. Never executes. */
  const prepare = async (
    action: string,
    args: Record<string, unknown>,
    summary: string,
  ): Promise<AssistantReply> => {
    const tool = tools.find((t) => t.name === action && !t.read);
    if (!tool) throw new Error("That action is not permitted.");
    const parsed = object(tool.schema.parse({ ...safeAssistantArguments(args), pin }));
    delete parsed["pin"];
    await ensureNoClashes(pin, action, parsed);
    const before = await baseline(pin, action, parsed);
    const sb = await assertAdmin(pin);
    const owner = await ownerHash(pin);
    await sb
      .from("admin_assistant_operations")
      .update({ status: "cancelled" })
      .eq("owner_hash", owner)
      .eq("conversation_id", conversationId)
      .eq("status", "pending");
    const { data: saved, error } = await sb
      .from("admin_assistant_operations")
      .insert({
        owner_hash: owner,
        conversation_id: conversationId,
        action,
        arguments: JSON.parse(JSON.stringify(parsed)),
        summary,
        before_state: JSON.parse(JSON.stringify(before ?? null)),
      })
      .select("*")
      .single();
    if (error || !saved) throw new Error("Could not prepare this change.");
    return reply(`Ready to save:\n${summary}\nShould I confirm this change?`, {
      proposal: proposal(saved),
    });
  };

  const freeTimes = async (
    date: string,
    audience: "men" | "women",
    serviceIds: string[],
    reference?: string,
  ) => {
    const r = await read<{
      slots?: { minute: number; available: boolean }[];
      closed?: boolean;
      message?: string;
    }>("adminAvailability", { date, audience, serviceIds, ...(reference ? { reference } : {}) });
    return {
      free: (r.slots ?? []).filter((s) => s.available).map((s) => s.minute),
      closed: Boolean(r.closed),
      message: r.message ?? "",
    };
  };
  const nearest = (free: number[], want: number) =>
    [...free]
      .sort((x, y) => Math.abs(x - want) - Math.abs(y - want))
      .slice(0, 6)
      .sort((x, y) => x - y)
      .map(ml)
      .join(" · ");
  const bookingsIn = async (from: string, to: string) =>
    (await read<{ bookings: Bk[] }>("adminRange", { from, to })).bookings;
  const resolveBooking = async (
    who: { ref?: string; name?: string; date?: string; time?: number },
    todayOnly = false,
  ): Promise<Bk | string> => {
    if (who.ref) {
      const r = await read<{ booking: Bk | null }>("adminBooking", { reference: who.ref });
      return r.booking ?? `I couldn't find booking ${who.ref}.`;
    }
    if (!who.name)
      return "Whose booking? Add their name, booking number or ID (e.g. “booking number 5”).";
    const from = who.date ?? today,
      to = who.date ?? (todayOnly ? today : C.addDays(today, 30));
    const hits = (await bookingsIn(from, to)).filter(
      (b) =>
        b.status !== "cancelled" &&
        C.nameMatches(who.name!, b.customer.name) &&
        (who.time == null || b.time === who.time),
    );
    if (!hits.length)
      return `I couldn't find a booking for ${who.name}${who.date ? ` on ${dayText(who.date)}` : todayOnly ? " today" : " in the next 30 days"}.`;
    if (hits.length > 1) {
      remember({
        list: hits
          .slice(0, 10)
          .map((b) => ({
            type: "booking",
            id: b.reference,
            label: `${dayText(b.date)} ${ml(b.time)} ${b.customer.name}`,
          })),
      });
      return `${hits.length} bookings match “${who.name}”:\n${hits
        .slice(0, 10)
        .map((b, i) => `${i + 1}. ${dayText(b.date)} ${bLine(b)}`)
        .join("\n")}\nWhich one? e.g. “the first one”.`;
    }
    return hits[0]!;
  };

  /** Everything that makes time unavailable in a range, as numbered items. */
  const unavailability = async (
    from: string,
    to: string,
    staff: Staff | null,
    scope: "all" | "closures",
  ) => {
    type Item = { sort: string; text: string; ref?: Ref; past: boolean };
    const items: Item[] = [];
    const past = (d: string) => d < today;
    if (scope === "all" && !staff) {
      const blocks =
        (await read<{ blocks?: Block[] }>("adminListBlocks", { from, to })).blocks ?? [];
      for (const b of blocks)
        items.push({
          sort: `${b.date}${String(b.start).padStart(4, "0")}`,
          past: past(b.date),
          text: `Salon · ${dayText(b.date)}, ${ml(b.start)}–${ml(b.end)} · ${b.reason || (b.kind === "break" ? "Break" : "Blocked")}`,
          ref: { type: "block", id: b.id, label: `salon ${dayText(b.date)} ${ml(b.start)}` },
        });
    }
    if (!staff) {
      const closures =
        (await read<{ closures?: Closure[] }>("adminClosures", {}).catch(() => ({ closures: [] })))
          .closures ?? [];
      for (const c of closures.filter((c) => c.start <= to && (c.end ?? "9999") >= from))
        items.push({
          sort: `${c.start}0000`,
          past: false,
          text: `Salon closed · ${dayText(c.start)}${c.end && c.end !== c.start ? ` – ${dayText(c.end)}` : c.end ? "" : " onwards"}${c.startMinute != null && c.endMinute != null ? `, ${ml(c.startMinute)}–${ml(c.endMinute)}` : ""}${c.reason ? ` · ${c.reason}` : ""}`,
          ref: { type: "closure", id: c.id, label: `closure ${dayText(c.start)}` },
        });
    }
    if (scope === "all") {
      for (const st of staffRows.filter((s) => !staff || s.id === staff.id)) {
        for (const b of st.blocks.filter((b) => b.date >= from && b.date <= to))
          items.push({
            sort: `${b.date}${String(b.start).padStart(4, "0")}`,
            past: past(b.date),
            text: `${st.name} · ${dayText(b.date)}, ${ml(b.start)}–${ml(b.end)} · ${b.reason || "Not available"}`,
            ref: {
              type: "staffBlock",
              id: b.id,
              staffId: st.id,
              label: `${st.name} ${dayText(b.date)} ${ml(b.start)}`,
            },
          });
        for (const l of st.leave.filter((l) => l.start <= to && l.end >= from))
          items.push({
            sort: `${l.start}0000`,
            past: past(l.end),
            text: `${st.name} on leave · ${dayText(l.start)}${l.end !== l.start ? ` – ${dayText(l.end)}` : ""}${l.reason ? ` · ${l.reason}` : ""}`,
            ref: {
              type: "leave",
              id: l.id,
              staffId: st.id,
              label: `${st.name} leave ${dayText(l.start)}`,
            },
          });
      }
    }
    items.sort((a, b) => a.sort.localeCompare(b.sort));
    return items;
  };

  /** One stylist on one day: hours, breaks, blocks, leave and their bookings. */
  const stylistDay = async (st: Staff, date: string) => {
    const d = await read<{
      plan: { closed?: boolean };
      team:
        | {
            id: string;
            working: boolean;
            start: number | null;
            end: number | null;
            breaks: { start: number; end: number }[];
            blocks: { start: number; end: number; label?: string }[];
          }[]
        | null;
      bookings: Bk[];
    }>("adminDay", { date });
    const row = staffRows.find((s) => s.id === st.id);
    const leave = row?.leave.find((l) => l.start <= date && l.end >= date);
    const mine = d.bookings.filter((b) => live(b) && b.staffId === st.id);
    if (d.plan?.closed) return `${dayText(date)}: the salon is closed.`;
    if (leave)
      return `${dayText(date)}: ${st.name} is on leave${leave.reason ? ` (${leave.reason})` : ""}.`;
    const t = (d.team ?? []).find((x) => x.id === st.id);
    if (!t || !t.working || t.start == null || t.end == null)
      return `${dayText(date)}: ${st.name} is not working.`;
    const lines = [`${dayText(date)}: ${st.name} works ${ml(t.start)}–${ml(t.end)}.`];
    if (t.breaks.length)
      lines.push(`Breaks: ${t.breaks.map((b) => `${ml(b.start)}–${ml(b.end)}`).join(", ")}`);
    const blocks = row?.blocks.filter((b) => b.date === date) ?? [];
    if (blocks.length)
      lines.push(
        `Not available: ${blocks.map((b) => `${ml(b.start)}–${ml(b.end)}${b.reason ? ` (${b.reason})` : ""}`).join(", ")}`,
      );
    lines.push(
      mine.length
        ? `Booked (${mine.length}): ${mine.map((b) => `${ml(b.time)} ${b.customer.name}`).join(", ")}`
        : "No bookings yet.",
    );
    return lines.join("\n");
  };

  /** Find what to remove: salon blocks, closures, a stylist's blocks and leave. */
  const removeOne = async (ref: Ref): Promise<AssistantReply> => {
    if (ref.type === "block") {
      const b = (
        (
          await read<{ blocks?: Block[] }>("adminListBlocks", {
            from: C.addDays(today, -60),
            to: C.addDays(today, 365),
          })
        ).blocks ?? []
      ).find((x) => x.id === ref.id);
      if (!b) return reply("That block isn't there any more.");
      return prepare(
        "adminArchiveBlock",
        { id: b.id },
        `Remove salon block · ${dayText(b.date)}, ${ml(b.start)}–${ml(b.end)} · ${b.reason || "Blocked"}`,
      );
    }
    if (ref.type === "closure") {
      const c = ((await read<{ closures?: Closure[] }>("adminClosures", {})).closures ?? []).find(
        (x) => x.id === ref.id,
      );
      if (!c) return reply("That closure isn't there any more.");
      return prepare(
        "adminReopen",
        { id: c.id },
        `Reopen the salon · remove closure ${dayText(c.start)}${c.end && c.end !== c.start ? ` – ${dayText(c.end)}` : ""}${c.reason ? ` (${c.reason})` : ""}`,
      );
    }
    const st =
      staffRows.find((s) => s.id === ref.staffId) ??
      staffRows.find(
        (s) => s.blocks.some((b) => b.id === ref.id) || s.leave.some((l) => l.id === ref.id),
      );
    if (ref.type === "staffBlock") {
      const b = st?.blocks.find((x) => x.id === ref.id);
      if (!st || !b) return reply("That stylist block isn't there any more.");
      return prepare(
        "adminRemoveStaffTime",
        { kind: "block", id: b.id },
        `Remove ${st.name}'s block · ${dayText(b.date)}, ${ml(b.start)}–${ml(b.end)}${b.reason ? ` · ${b.reason}` : ""}`,
      );
    }
    if (ref.type === "leave") {
      const l = st?.leave.find((x) => x.id === ref.id);
      if (!st || !l) return reply("That leave isn't there any more.");
      return prepare(
        "adminRemoveStaffTime",
        { kind: "leave", id: l.id },
        `Remove ${st.name}'s leave · ${dayText(l.start)}${l.end !== l.start ? ` – ${dayText(l.end)}` : ""}${l.reason ? ` · ${l.reason}` : ""}`,
      );
    }
    return reply("I can't remove that.");
  };

  const timeline = (title: string, list: Bk[], withDate: boolean): AssistantView => ({
    type: "timeline",
    title,
    rows: list.map((b) => ({
      ...(withDate ? { date: dayText(b.date) } : {}),
      time: ml(b.time),
      customer: b.customer.name,
      service: b.services.map((x) => x.name).join(", "),
      ...(b.staffName ? { stylist: b.staffName } : {}),
      status: STATUS[b.status] ?? b.status,
    })),
  });

  switch (intent.kind) {
    case "help":
      return reply(
        `You can talk normally. For example:\n• which timings did I block? · show all salon closures\n• is Meera available tomorrow? · who is working tomorrow? · show Kiran's schedule\n• who is booked today? · who is coming at 4 pm? · how many bookings this weekend?\n• how much did we earn this week? · how many customers visited this month?\n• block Kiran tomorrow from 2 to 4 pm · close the salon next Monday for maintenance\n• remove tomorrow's block · remove the first one · reopen the salon tomorrow\n• book Ravi 9876543210 haircut tomorrow 4 pm · reschedule Rahul to 6 pm · cancel booking number 5\n• Ravi arrived · Ravi done · Ravi no show\n• what is the price of Basic Haircut? · change Beard Trim to ₹350 · which services are inactive?\n• undo (the last change)`,
      );

    case "clarify":
      if (intent.staff && intent.date) {
        remember({ staff: intent.staff, date: intent.date, awaiting: "staffHours" });
        return reply(intent.question, { actions: [calendarAt(intent.date)] });
      }
      return reply(intent.question);

    case "navigate": {
      const page = intent.page === "dashboard" ? "" : intent.page;
      if (intent.page === "customers" && intent.name) {
        const r = await read<{ customers?: { id: string; name: string; phone: string }[] }>(
          "adminCustomers",
          { q: intent.name },
        );
        const list = r.customers ?? [];
        if (list.length === 1)
          return reply(`Opening ${list[0]!.name}'s customer details.`, {
            navigate: go(list[0]!.name, "customers", { id: list[0]!.id }),
          });
        if (list.length > 1)
          return reply(`${list.length} customers match “${intent.name}”. Which one?`, {
            actions: list
              .slice(0, 5)
              .map((c) => go(`${c.name} · ${c.phone}`, "customers", { id: c.id })),
          });
        return reply(`I couldn't find a customer called “${intent.name}”.`, {
          actions: [go("Open Customers", "customers")],
        });
      }
      const names: Record<string, string> = {
        "": "the dashboard",
        calendar: "the calendar",
        appointments: "Appointments",
        customers: "Customers",
        services: "the menu & prices",
        reports: "Reports",
        activity: "the activity history",
        closures: "Closures",
        staff: "Staff",
        rules: "Booking rules",
        settings: "Settings",
        notifications: "Notifications",
        content: "Website content",
        system: "System health",
      };
      return reply(
        `Opening ${names[page] ?? page}${page === "calendar" && intent.date ? ` on ${dayText(intent.date)}` : ""}.`,
        {
          navigate: go(
            names[page] ?? page,
            page,
            page === "calendar" && intent.date ? { date: intent.date } : undefined,
          ),
        },
      );
    }

    case "unavailable": {
      const { from, to } = intent.range;
      const items = await unavailability(from, to, intent.staff, intent.scope);
      // single day: the salon's own breaks (lunch) are unavailable too
      if (from === to && intent.scope === "all" && !intent.staff) {
        const d = await read<{
          plan: { closed?: boolean; breaks?: { start: number; end: number; label?: string }[] };
        }>("adminDay", { date: from });
        for (const br of d.plan?.breaks ?? [])
          if (!items.some((i) => i.text.includes(`${ml(br.start)}–${ml(br.end)}`)))
            items.push({
              sort: `${from}${String(br.start).padStart(4, "0")}`,
              past: false,
              text: `Salon · ${dayText(from)}, ${ml(br.start)}–${ml(br.end)} · ${br.label || "Break"}`,
            });
        items.sort((a, b) => a.sort.localeCompare(b.sort));
      }
      const what =
        intent.scope === "closures"
          ? "salon closures"
          : intent.staff
            ? `periods when ${intent.staff.name} is unavailable`
            : "blocked times";
      const countOf = (n: number) =>
        n === 1
          ? `There is 1 ${what.replace("closures", "closure").replace("periods", "period").replace("times", "time")}`
          : `There are ${n} ${what}`;
      const span = intent.defaultRange
        ? intent.scope === "closures"
          ? "from today on"
          : "in the last 30 days and the next 60 days"
        : rangeText(intent.range, today);
      remember({
        list: items.filter((i) => i.ref).map((i) => i.ref!),
        ...(intent.staff ? { staff: intent.staff } : {}),
        ...(from === to ? { date: from } : {}),
        last: intent,
      });
      if (!items.length)
        return reply(
          `You don't have any ${what} ${span}.${intent.defaultRange ? " (I checked the last 30 days and the next 60 days.)" : ""}`.replace(
            "closures from today on",
            "closures coming up",
          ),
          { actions: [calendarAt(from === to ? from : null)] },
        );
      const numbered = items.map((i, n) => `${n + 1}. ${i.text}${i.past ? " (past)" : ""}`);
      const view: AssistantView = {
        type: "list",
        title: `${items.length} · ${span}`,
        rows: items.map((i, n) => {
          const [who, rest = ""] =
            i.text.split(" · ", 2).length > 1
              ? [i.text.split(" · ")[0]!, i.text.split(" · ").slice(1).join(" · ")]
              : [i.text, ""];
          const [when, ...why] = rest.split(" · ");
          return {
            primary: `${n + 1}. ${when || who}`,
            ...(why.length ? { secondary: why.join(" · ") } : {}),
            tag: who!,
            meta: i.past ? "Past" : "Active",
            muted: i.past,
          };
        }),
      };
      const first = items.find((i) => !i.past)?.sort.slice(0, 10);
      const actions = [
        calendarAt(from === to ? from : first),
        ...(intent.scope === "closures"
          ? [go("Open Closures", "closures")]
          : intent.staff
            ? [go("Open Staff", "staff")]
            : []),
      ];
      return reply(
        `${countOf(items.length)} ${span}:\n${numbered.join("\n")}\nWant to change or remove any? e.g. “remove the first one”.`,
        { view, actions },
      );
    }

    case "available": {
      remember({
        staff: intent.staff,
        last: intent,
        ...(intent.date ? { date: intent.date } : {}),
      });
      if (intent.date)
        return reply(await stylistDay(intent.staff, intent.date), {
          actions: [calendarAt(intent.date)],
        });
      // no date: the coming week at a glance
      const row = staffRows.find((s) => s.id === intent.staff.id);
      if (!row) return reply(`I couldn't find ${intent.staff.name}.`);
      const days = (
        await read<{ days: { date: string; closed: boolean }[] }>("adminRange", {
          from: today,
          to: C.addDays(today, 6),
        })
      ).days;
      const lines = days.map((d) => {
        const h = row.hours.find((x) => x.day === dowOf(d.date));
        const lv = row.leave.find((l) => l.start <= d.date && l.end >= d.date);
        const bl = row.blocks.filter((b) => b.date === d.date);
        const base = d.closed
          ? "salon closed"
          : lv
            ? `on leave${lv.reason ? ` (${lv.reason})` : ""}`
            : !h?.working
              ? "off"
              : `${ml(h.start)}–${ml(h.end)}`;
        return `• ${dayText(d.date)}: ${base}${!d.closed && !lv && h?.working && bl.length ? ` · not available ${bl.map((b) => `${ml(b.start)}–${ml(b.end)}`).join(", ")}` : ""}`;
      });
      return reply(`${intent.staff.name} in the next 7 days:\n${lines.join("\n")}`, {
        view: {
          type: "list",
          title: `${intent.staff.name} · next 7 days`,
          rows: lines.map((l) => {
            const [d, ...r] = l.replace("• ", "").split(": ");
            return { primary: d!, secondary: r.join(": ") };
          }),
        },
        actions: [go("Open Staff", "staff")],
      });
    }

    case "schedule":
      remember({ staff: intent.staff, date: intent.date, last: intent });
      return reply(await stylistDay(intent.staff, intent.date), {
        actions: [calendarAt(intent.date)],
      });

    case "working": {
      remember({ date: intent.date, last: intent });
      const d = await read<{
        plan: { closed?: boolean };
        team:
          | {
              id: string;
              name: string;
              working: boolean;
              start: number | null;
              end: number | null;
            }[]
          | null;
      }>("adminDay", { date: intent.date });
      if (d.plan?.closed) return reply(`${dayText(intent.date)}: the salon is closed.`);
      const team = d.team ?? [];
      const on = team.filter((x) => x.working && x.start != null);
      const off = team.filter((x) => !x.working || x.start == null);
      return reply(
        `${dayText(intent.date)}:\n${on.length ? on.map((x) => `• ${x.name}: ${ml(x.start!)}–${ml(x.end!)}`).join("\n") : "Nobody is working."}${off.length ? `\nNot working: ${off.map((x) => x.name).join(", ")}` : ""}`,
        {
          view: {
            type: "list",
            title: `Working · ${dayText(intent.date)}`,
            rows: [
              ...on.map((x) => ({
                primary: x.name,
                meta: `${ml(x.start!)}–${ml(x.end!)}`,
                tag: "Working",
              })),
              ...off.map((x) => ({ primary: x.name, tag: "Off", muted: true })),
            ],
          },
          actions: [calendarAt(intent.date), go("Open Staff", "staff")],
        },
      );
    }

    case "onLeave": {
      const { from, to } = intent.range;
      const hits = staffRows.flatMap((s) =>
        s.leave.filter((l) => l.start <= to && l.end >= from).map((l) => ({ s, l })),
      );
      remember({
        list: hits.map(({ s, l }) => ({
          type: "leave" as const,
          id: l.id,
          staffId: s.id,
          label: `${s.name} leave`,
        })),
        last: {
          kind: "unavailable",
          range: intent.range,
          staff: null,
          scope: "all",
          defaultRange: false,
        },
      });
      return reply(
        hits.length
          ? `On leave ${rangeText(intent.range, today)}:\n${hits.map(({ s, l }, i) => `${i + 1}. ${s.name} · ${dayText(l.start)}${l.end !== l.start ? ` – ${dayText(l.end)}` : ""}${l.reason ? ` · ${l.reason}` : ""}`).join("\n")}`
          : `Nobody is on leave ${rangeText(intent.range, today)}.`,
      );
    }

    case "staffBlock":
      remember({ staff: intent.staff, date: intent.date });
      return prepare(
        "adminAddStaffBlock",
        {
          staffId: intent.staff.id,
          date: intent.date,
          start: intent.start,
          end: intent.end,
          reason: intent.reason,
        },
        `Block ${intent.staff.name} · ${dayText(intent.date)}, ${ml(intent.start)}–${ml(intent.end)} · ${intent.reason}`,
      );

    case "staffLeave": {
      const s = [...intent.dates].sort();
      remember({ staff: intent.staff, date: s[0] });
      return prepare(
        "adminAddLeave",
        { staffId: intent.staff.id, start: s[0], end: s[s.length - 1], reason: intent.reason },
        `${intent.staff.name} off · ${s.length > 1 ? `${dayText(s[0]!)} – ${dayText(s[s.length - 1]!)}` : dayText(s[0]!)} · ${intent.reason}`,
      );
    }

    case "remove": {
      const T = intent.target;
      if (T.ref) return removeOne(T.ref);
      const from = T.date ?? today,
        to = T.date ?? C.addDays(today, 90);
      let items = (
        await unavailability(from, to, T.staff, T.scope === "closure" ? "closures" : "all")
      ).filter((i) => i.ref && !i.past);
      if (T.scope === "salon")
        items = items.filter((i) => i.ref!.type === "block" || i.ref!.type === "closure");
      if (T.scope === "staff")
        items = items.filter((i) => i.ref!.type === "staffBlock" || i.ref!.type === "leave");
      if (T.time != null || T.period) {
        const s = T.time ?? T.period!.start,
          e = T.time != null ? T.time + 1 : T.period!.end;
        items = items.filter((i) => {
          const m = /, (\d{1,2}:\d{2} [AP]M)–(\d{1,2}:\d{2} [AP]M)/.exec(i.text);
          if (!m) return false;
          const toMin = (x: string) => {
            const [hm, ap] = x.split(" ");
            const [h, mm] = hm!.split(":").map(Number);
            return ((h! % 12) + (ap === "PM" ? 12 : 0)) * 60 + mm!;
          };
          return overlaps(toMin(m[1]!), toMin(m[2]!), s, e);
        });
      }
      if (!items.length)
        return reply(
          `I couldn't find ${T.scope === "closure" ? "a closure" : "a block"}${T.staff ? ` for ${T.staff.name}` : ""}${T.date ? ` on ${dayText(T.date)}` : " coming up"}${T.time != null ? ` at ${ml(T.time)}` : ""}. Ask “which timings did I block?” to see them all.`,
        );
      if (items.length === 1) return removeOne(items[0]!.ref!);
      remember({ list: items.map((i) => i.ref!) });
      return reply(
        `I found ${items.length}. Which one should I remove?\n${items.map((i, n) => `${n + 1}. ${i.text}`).join("\n")}\nSay e.g. “remove the first one”.`,
      );
    }

    case "pick": {
      const ref = memory.list?.[intent.index];
      if (!ref) return reply("I don't have that item any more. Please ask again.");
      const b = (await read<{ booking: Bk | null }>("adminBooking", { reference: ref.id })).booking;
      if (!b) return reply("That booking isn't there any more.");
      if (intent.action === "show")
        return reply(
          `${b.reference}${b.bookingNo ? ` (no. ${b.bookingNo})` : ""} · ${dayText(b.date)} ${bLine(b)} · ${b.customer.phone}`,
        );
      return prepare(
        "adminUpsertBooking",
        {
          reference: b.reference,
          patch: {
            status: "cancelled",
            meta: { status: "cancelled" },
            cancelReason: "Cancelled by the salon",
          },
        },
        `Cancel ${b.customer.name}'s booking (${b.reference}) · ${dayText(b.date)}, ${ml(b.time)}`,
      );
    }

    case "bookings": {
      const { from, to } = intent.range;
      let list = (await bookingsIn(from, to)).filter(live);
      if (intent.staff) list = list.filter((b) => b.staffId === intent.staff!.id);
      if (intent.time != null)
        list = list.filter((b) => b.time <= intent.time! && intent.time! < b.end);
      remember({
        list: list
          .slice(0, 15)
          .map((b) => ({
            type: "booking" as const,
            id: b.reference,
            label: `${dayText(b.date)} ${ml(b.time)} ${b.customer.name}`,
          })),
        last: intent,
        ...(intent.staff ? { staff: intent.staff } : {}),
        ...(from === to ? { date: from } : {}),
      });
      const where = `${intent.staff ? ` with ${intent.staff.name}` : ""}${intent.time != null ? ` at ${ml(intent.time)}` : ""} ${rangeText(intent.range, today)}`;
      if (!list.length)
        return reply(`No bookings${where}.`, { actions: [calendarAt(from === to ? from : null)] });
      const value = list.reduce((n, b) => n + b.price, 0);
      const acts = [
        calendarAt(from === to ? from : list[0]?.date),
        go("Open Appointments", "appointments"),
      ];
      if (intent.count)
        return reply(
          `${list.length} booking${list.length === 1 ? "" : "s"}${where} · ${inr(value)}.`,
          {
            view: {
              type: "stats",
              title: `Bookings${where}`,
              stats: [
                { label: "Bookings", value: String(list.length) },
                { label: "Value", value: inr(value) },
              ],
            },
            actions: acts,
          },
        );
      return reply(
        `${list.length} booking${list.length === 1 ? "" : "s"}${where} · ${inr(value)}:\n${list
          .slice(0, 15)
          .map((b, i) => `${i + 1}. ${from !== to ? `${dayText(b.date)} ` : ""}${bLine(b)}`)
          .join("\n")}${list.length > 15 ? `\n…and ${list.length - 15} more.` : ""}`,
        {
          view: timeline(
            `${list.length} booking${list.length === 1 ? "" : "s"}${where} · ${inr(value)}`,
            list.slice(0, 30),
            from !== to,
          ),
          actions: acts,
        },
      );
    }

    case "bookingNo": {
      const all = (await bookingsIn(C.addDays(today, -60), C.addDays(today, 180))).filter(
        (b) => b.bookingNo === intent.no && b.status !== "cancelled",
      );
      const b = all.sort(
        (x, y) =>
          (x.date < today ? 1 : 0) - (y.date < today ? 1 : 0) || x.date.localeCompare(y.date),
      )[0];
      if (!b) return reply(`There's no active booking number ${intent.no}.`);
      remember({ list: [{ type: "booking", id: b.reference, label: `no. ${intent.no}` }] });
      if (intent.then === "show")
        return reply(
          `Booking no. ${intent.no} (${b.reference}) · ${dayText(b.date)} ${bLine(b)} · ${b.customer.phone}`,
        );
      return prepare(
        "adminUpsertBooking",
        {
          reference: b.reference,
          patch: {
            status: "cancelled",
            meta: { status: "cancelled" },
            cancelReason: intent.reason || "Cancelled by the salon",
          },
        },
        `Cancel booking no. ${intent.no} · ${b.customer.name} (${b.reference}) · ${dayText(b.date)}, ${ml(b.time)}${intent.reason ? ` · reason: ${intent.reason}` : ""}`,
      );
    }

    case "nextFor": {
      const hits = (await bookingsIn(today, C.addDays(today, 180)))
        .filter((b) => live(b) && C.nameMatches(intent.name, b.customer.name))
        .sort((x, y) => (x.date + x.time).localeCompare(y.date + y.time));
      if (!hits.length) return reply(`${intent.name} has no upcoming appointment.`);
      const b = hits[0]!;
      remember({ list: [{ type: "booking", id: b.reference, label: b.customer.name }] });
      return reply(
        `${b.customer.name}'s next appointment: ${dayText(b.date)}, ${bLine(b)} (${b.reference})${hits.length > 1 ? `\nThey have ${hits.length - 1} more after that.` : ""}`,
      );
    }

    case "report": {
      const all = await bookingsIn(intent.range.from, intent.range.to);
      remember({ last: intent });
      const done = all.filter((b) => b.status === "completed");
      const earned = done.reduce((n, b) => n + (b.amountPaid ?? b.price), 0);
      const active = all.filter(live);
      const people = new Set(
        done.map((b) => b.customer.phone.replace(/\D/g, "").slice(-10) || b.customer.name),
      ).size;
      const when = rangeText(intent.range, today);
      const byDay = new Map<string, number>();
      for (const b of done) byDay.set(b.date, (byDay.get(b.date) ?? 0) + (b.amountPaid ?? b.price));
      const days: string[] = [];
      for (let d = intent.range.from; d <= intent.range.to && days.length < 31; d = C.addDays(d, 1))
        days.push(d);
      const pendingValue = active
        .filter((b) => b.status !== "completed")
        .reduce((n, b) => n + b.price, 0);
      const view: AssistantView = {
        type: "stats",
        title: `${when[0]!.toUpperCase()}${when.slice(1)}`,
        stats: [
          { label: "Earned", value: inr(earned) },
          { label: "Completed", value: String(done.length) },
          { label: "Customers", value: String(people) },
          { label: "Still to come", value: inr(pendingValue) },
        ],
        ...(days.length > 1
          ? {
              bars: days.map((d) => ({
                label: dayText(d).split(",")[0]!,
                value: byDay.get(d) ?? 0,
                text: inr(byDay.get(d) ?? 0),
              })),
            }
          : {}),
      };
      const reportActs = [go("Open Reports", "reports")];
      if (intent.metric === "revenue")
        return reply(
          `Earned ${when}: ${inr(earned)} from ${done.length} completed visit${done.length === 1 ? "" : "s"}.${active.length > done.length ? `\nStill to come or unfinished: ${active.length - done.length} booking${active.length - done.length === 1 ? "" : "s"} worth ${inr(active.filter((b) => b.status !== "completed").reduce((n, b) => n + b.price, 0))}.` : ""}`,
          { view, actions: reportActs },
        );
      if (intent.metric === "completed")
        return reply(
          `${done.length} appointment${done.length === 1 ? "" : "s"} completed ${when} · ${inr(earned)}.`,
          { view, actions: reportActs },
        );
      if (intent.metric === "customers")
        return reply(
          `${people} customer${people === 1 ? "" : "s"} visited ${when} (${done.length} completed visit${done.length === 1 ? "" : "s"}).`,
          { view, actions: reportActs },
        );
      return reply(
        `${when[0]!.toUpperCase()}${when.slice(1)}:\n• ${active.length} bookings worth ${inr(active.reduce((n, b) => n + b.price, 0))}\n• ${done.length} completed · ${inr(earned)} earned\n• ${all.filter((b) => b.status === "cancelled").length} cancelled · ${all.filter((b) => b.status === "no-show").length} no-show`,
        { view, actions: reportActs },
      );
    }

    case "servicePrice": {
      const cat = await read<{ services: Svc[] }>("adminCatalogue", {});
      const names = new Set(
        cat.services
          .filter((s) => intent.serviceIds.includes(s.id))
          .map((s) => s.name.toLowerCase()),
      );
      const hits = cat.services.filter((s) => names.has(s.name.toLowerCase()) && !s.archived);
      if (!hits.length) return reply("I couldn't find that service in the menu.");
      return reply(
        hits
          .map(
            (s) =>
              `• ${s.name} (${s.gender}): ${s.from ? "from " : ""}${inr(s.price)} · ${s.minutes} min${s.active ? "" : " · inactive"}`,
          )
          .join("\n"),
        { actions: [go("Open Services", "services")] },
      );
    }

    case "serviceList": {
      const cat = await read<{ services: Svc[] }>("adminCatalogue", {});
      const list = cat.services.filter((s) =>
        intent.active ? s.active && !s.archived : !s.active || s.archived,
      );
      if (!list.length)
        return reply(intent.active ? "There are no active services." : "All services are active.");
      const by = (g: string) =>
        list.filter((s) => s.gender === g).map((s) => `${s.name} ${inr(s.price)}`);
      const men = by("men"),
        women = by("women");
      return reply(
        `${list.length} ${intent.active ? "active" : "inactive"} service${list.length === 1 ? "" : "s"}:${men.length ? `\nMen (${men.length}): ${men.join(", ")}` : ""}${women.length ? `\nWomen (${women.length}): ${women.join(", ")}` : ""}`,
        {
          view: {
            type: "list",
            title: `${list.length} ${intent.active ? "active" : "inactive"} services`,
            rows: list
              .slice(0, 80)
              .map((x) => ({
                primary: x.name,
                meta: inr(x.price),
                tag: x.gender === "men" ? "Men" : "Women",
                ...(x.active && !x.archived
                  ? {}
                  : { secondary: x.archived ? "Archived" : "Inactive", muted: true }),
              })),
          },
          actions: [go("Open Services", "services")],
        },
      );
    }

    case "undo":
      return undoLast();

    /* ── the classic commands (bookings, blocks, closures, prices, …) ── */
    case "unknown":
      return reply("Sorry, I didn't get that. Try “help” to see what I can do.");
    case "day": {
      const r = await read<{ bookings: Bk[]; plan: { closed?: boolean }; blocks: Block[] }>(
        "adminDay",
        { date: intent.date },
      );
      const list = r.bookings.filter(live);
      remember({
        date: intent.date,
        list: list
          .slice(0, 15)
          .map((b) => ({ type: "booking" as const, id: b.reference, label: b.customer.name })),
        last: {
          kind: "bookings",
          range: { from: intent.date, to: intent.date, label: intent.date },
          staff: null,
          time: null,
          count: false,
        },
      });
      if (r.plan?.closed) return reply(`${dayText(intent.date)}: the salon is closed.`);
      const blocks = (r.blocks ?? []).map(
        (b) =>
          `Blocked ${ml(b.start)}–${ml(b.end)} · ${b.reason || (b.kind === "break" ? "Break" : "Blocked")}`,
      );
      return reply(
        list.length
          ? `${dayText(intent.date)}: ${list.length} booking${list.length === 1 ? "" : "s"} · ${inr(list.reduce((n, b) => n + b.price, 0))}\n${[...list.map((b, i) => `${i + 1}. ${bLine(b)}`), ...blocks].join("\n")}`
          : `${dayText(intent.date)}: no bookings yet.${blocks.length ? `\n${blocks.join("\n")}` : ""}`,
        {
          ...(list.length
            ? {
                view: timeline(
                  `${dayText(intent.date)} · ${list.length} booking${list.length === 1 ? "" : "s"} · ${inr(list.reduce((n, b) => n + b.price, 0))}`,
                  list,
                  false,
                ),
              }
            : {}),
          actions: [calendarAt(intent.date)],
        },
      );
    }
    case "at": {
      const list = (await bookingsIn(intent.date, intent.date)).filter(
        (b) => live(b) && b.time <= intent.time && intent.time < b.end,
      );
      return reply(
        list.length
          ? `At ${ml(intent.time)} on ${dayText(intent.date)}:\n${list.map((b) => `• ${bLine(b)}`).join("\n")}`
          : `Nobody is booked at ${ml(intent.time)} on ${dayText(intent.date)}.`,
      );
    }
    case "summary":
      return planReply(pin, conversationId, `revenue ${intent.range.label}`, next);
    case "free": {
      const f = await freeTimes(intent.date, intent.audience, intent.serviceIds);
      if (f.closed) return reply(`The salon is closed on ${dayText(intent.date)}.`);
      return reply(
        f.free.length
          ? `Free on ${dayText(intent.date)}:\n${f.free.map(ml).join(" · ")}`
          : f.message || `No free times on ${dayText(intent.date)}.`,
      );
    }
    case "find": {
      if (/^BK-/i.test(intent.name)) {
        const b = (
          await read<{ booking: Bk | null }>("adminBooking", {
            reference: intent.name.toUpperCase(),
          })
        ).booking;
        return reply(
          b ? `${b.reference} · ${dayText(b.date)} ${bLine(b)}` : `I couldn't find ${intent.name}.`,
        );
      }
      const all = (await bookingsIn(C.addDays(today, -30), C.addDays(today, 60))).filter((b) =>
        C.nameMatches(intent.name, b.customer.name),
      );
      if (!all.length)
        return reply(
          `I couldn't find a customer called “${intent.name}” with bookings in the last 30 or next 60 days. If you meant something else, try “help”.`,
        );
      const up = all.filter((b) => b.date >= today && b.status !== "cancelled");
      remember({
        list: (up.length ? up : all.slice(-5))
          .slice(0, 10)
          .map((b) => ({ type: "booking" as const, id: b.reference, label: b.customer.name })),
      });
      return reply(
        `${up.length ? `Upcoming for “${intent.name}”` : `No upcoming booking for “${intent.name}”. Recent`}:\n${(up.length ? up : all.slice(-5)).map((b, i) => `${i + 1}. ${dayText(b.date)} ${bLine(b)} · ${b.reference}`).join("\n")}`,
      );
    }
    case "customer": {
      const r = await read<{
        customers?: { name: string; phone: string; email: string; total?: number }[];
      }>("adminCustomers", { q: intent.name });
      const list = (r.customers ?? []).slice(0, 5);
      return reply(
        list.length
          ? list
              .map(
                (c) =>
                  `• ${c.name} · ${c.phone}${c.email ? ` · ${c.email}` : ""}${c.total ? ` · ${c.total} visit${c.total === 1 ? "" : "s"}` : ""}`,
              )
              .join("\n")
          : `I couldn't find a customer called “${intent.name}”.`,
        {
          actions: list
            .slice(0, 3)
            .map((c) => go(`Open ${c.name}`, "customers", { id: (c as { id?: string }).id ?? "" }))
            .filter((a) => a.search?.id),
        },
      );
    }
    case "book": {
      const missing = [
        !intent.name && "the customer's name",
        intent.phone.length !== 10 && "a 10-digit phone number",
        !intent.serviceIds.length && "the service",
        intent.time == null && "the time",
      ].filter(Boolean);
      if (missing.length)
        return reply(
          `To book I also need ${missing.join(", ")}. For example: “book Ravi 9876543210 haircut tomorrow 4 pm”.`,
        );
      const date = intent.date ?? today,
        time = intent.time!;
      const f = await freeTimes(date, intent.audience, intent.serviceIds);
      if (!f.free.includes(time))
        return reply(
          f.closed
            ? `The salon is closed on ${dayText(date)}.`
            : !f.free.length && f.message
              ? f.message
              : `${ml(time)} on ${dayText(date)} isn't free.${f.free.length ? ` Nearest free times: ${nearest(f.free, time)}` : " No free times that day."}`,
        );
      const services = menuFor(intent.audience)
        .flatMap((c) => c.services)
        .filter((s) => intent.serviceIds.includes(s.id));
      return prepare(
        "adminUpsertBooking",
        {
          reference: "new",
          insert: {
            audience: intent.audience,
            serviceIds: intent.serviceIds,
            date,
            time,
            customer: { name: intent.name, phone: intent.phone, email: "" },
            source: date === today ? "walk-in" : "phone",
          },
        },
        `New booking · ${intent.name} (${intent.phone}) · ${services.map((s) => s.name).join(", ")} · ${dayText(date)}, ${ml(time)} · ${inr(services.reduce((n, s) => n + s.price, 0))}`,
      );
    }
    case "move": {
      const b = await resolveBooking(intent.who);
      if (typeof b === "string") return reply(b);
      const date = intent.date ?? b.date,
        time = intent.time ?? b.time;
      if (date === b.date && time === b.time)
        return reply(`Where to? e.g. “move ${b.customer.name.split(" ")[0]} to 5 pm”.`);
      const f = await freeTimes(date, b.audience, b.serviceIds, b.reference);
      if (!f.free.includes(time))
        return reply(
          f.closed
            ? `The salon is closed on ${dayText(date)}.`
            : !f.free.length && f.message
              ? f.message
              : `${ml(time)} on ${dayText(date)} isn't free for ${b.customer.name}.${f.free.length ? ` Nearest free times: ${nearest(f.free, time)}` : " No free times that day."}`,
        );
      return prepare(
        "adminUpsertBooking",
        { reference: b.reference, patch: { date, time } },
        `Move ${b.customer.name} (${b.reference}) · ${dayText(b.date)}, ${ml(b.time)} → ${dayText(date)}, ${ml(time)}`,
      );
    }
    case "cancel": {
      const b = await resolveBooking(intent.who);
      if (typeof b === "string") return reply(b);
      return prepare(
        "adminUpsertBooking",
        {
          reference: b.reference,
          patch: {
            status: "cancelled",
            meta: { status: "cancelled" },
            cancelReason: intent.reason || "Cancelled by the salon",
          },
        },
        `Cancel ${b.customer.name}'s booking (${b.reference}) · ${dayText(b.date)}, ${ml(b.time)}${intent.reason ? ` · reason: ${intent.reason}` : ""}`,
      );
    }
    case "status": {
      const b = await resolveBooking(intent.who, !intent.who.date && !intent.who.ref);
      if (typeof b === "string") return reply(b);
      if (b.status === intent.status)
        return reply(`${b.customer.name} is already “${STATUS[intent.status]}”.`);
      return prepare(
        "adminUpsertBooking",
        { reference: b.reference, patch: { meta: { status: intent.status } } },
        `${b.customer.name} (${ml(b.time)}, ${dayText(b.date)}) · ${STATUS[b.status] ?? b.status} → ${STATUS[intent.status]}`,
      );
    }
    case "block": {
      const kind = /break|lunch/i.test(intent.reason) ? "break" : "block";
      remember({ date: intent.date });
      return prepare(
        "adminSaveBlock",
        { date: intent.date, start: intent.start, end: intent.end, kind, reason: intent.reason },
        `${kind === "break" ? "Add a salon break" : "Block the salon"} · ${dayText(intent.date)}, ${ml(intent.start)}–${ml(intent.end)} · ${intent.reason}`,
      );
    }
    case "close": {
      if (intent.dates.some((d) => d < today)) return reply("That date has already passed.");
      return prepare(
        "adminAddClosure",
        { kind: "dates", dates: intent.dates, reason: intent.reason },
        `Close the salon · ${intent.dates.map(dayText).join(", ")} · ${intent.reason}`,
      );
    }
    case "price": {
      const cat = await read<{ services: Svc[] }>("adminCatalogue", {});
      const svc = cat.services.filter((x) => intent.serviceIds.includes(x.id));
      if (svc.length !== 1)
        return reply(
          svc.length
            ? "Please name just one service, e.g. “change Beard Trim to ₹350”."
            : "I couldn't find that service in the menu.",
        );
      const x = svc[0]!;
      if (x.price === intent.price) return reply(`${x.name} is already ${inr(x.price)}.`);
      return prepare(
        "adminSaveService",
        {
          id: x.id,
          categoryId: x.categoryId,
          name: x.name,
          description: x.description,
          minutes: x.minutes,
          price: intent.price,
          from: x.from,
          order: x.order,
          active: x.active,
          buffer: x.buffer,
          featured: x.featured,
        },
        `${x.name} (${x.gender}) price · ${inr(x.price)} → ${inr(intent.price)}. Unfinished bookings take the new price; completed visits keep theirs.`,
      );
    }
    // older shapes the classic reader can still produce
    case "blocks":
      return planReply(pin, conversationId, "which timings did I block", next);
    case "unblock":
    case "reopen":
    case "staffOff":
      return reply(
        "Please say that again a little differently, e.g. “remove tomorrow’s block”, “reopen the salon on 25 Dec” or “block Kiran tomorrow 2 to 4 pm”.",
      );
  }
  return reply("Sorry, I didn't get that. Try “help”.");

  /**
   * Undo the last saved change of this conversation: prepared like any change
   * (preview + Confirm), and refused if the record changed since it was saved.
   */
  async function undoLast(): Promise<AssistantReply> {
    const sb = await assertAdmin(pin);
    const owner = await ownerHash(pin);
    const { data } = await sb
      .from("admin_assistant_operations")
      .select("*")
      .eq("owner_hash", owner)
      .eq("conversation_id", conversationId)
      .eq("status", "succeeded")
      .order("finished_at", { ascending: false })
      .limit(1);
    const last = data?.[0] as Record<string, unknown> | undefined;
    if (!last) return reply("There is nothing to undo in this conversation.");
    const summary = String(last["summary"]);
    if (summary.startsWith("Undo"))
      return reply("The last change was already an undo. Nothing more to undo here.");
    const action = String(last["action"]);
    const args = object(last["arguments"]);
    const before = last["before_state"];
    const after = object(last["result"])["verified"];
    // protect newer changes: the record must still be exactly as this change left it
    const now = await baseline(pin, action, args);
    if (now != null && after != null && !sameData(now, after))
      return reply(
        "This was changed again after the assistant saved it, so I won't undo it. Please change it from the admin pages.",
      );
    const label = `Undo: ${summary}`;
    if (action === "adminSaveBlock") {
      const b = (
        (
          await read<{ blocks?: Block[] }>("adminListBlocks", {
            from: String(args["date"]),
            to: String(args["date"]),
          })
        ).blocks ?? []
      ).find(
        (x) => x.start === args["start"] && x.end === args["end"] && x.reason === args["reason"],
      );
      return b
        ? prepare("adminArchiveBlock", { id: b.id }, label)
        : reply("That block is already gone.");
    }
    if (action === "adminArchiveBlock")
      return args["restore"]
        ? prepare("adminArchiveBlock", { id: args["id"] }, label)
        : prepare("adminArchiveBlock", { id: args["id"], restore: true }, label);
    if (action === "adminAddStaffBlock") {
      const b = staffRows
        .find((s) => s.id === args["staffId"])
        ?.blocks.find(
          (x) => x.date === args["date"] && x.start === args["start"] && x.end === args["end"],
        );
      return b
        ? prepare("adminRemoveStaffTime", { kind: "block", id: b.id }, label)
        : reply("That stylist block is already gone.");
    }
    if (action === "adminAddLeave") {
      const l = staffRows
        .find((s) => s.id === args["staffId"])
        ?.leave.find((x) => x.start === args["start"] && x.end === args["end"]);
      return l
        ? prepare("adminRemoveStaffTime", { kind: "leave", id: l.id }, label)
        : reply("That leave is already gone.");
    }
    if (action === "adminRemoveStaffTime") {
      const rows = (object(before)["staff"] as StaffRow[] | undefined) ?? [];
      for (const s of rows) {
        const b = s.blocks?.find((x) => x.id === args["id"]);
        if (b)
          return prepare(
            "adminAddStaffBlock",
            {
              staffId: s.id,
              date: b.date,
              start: b.start,
              end: b.end,
              reason: b.reason || "Not available",
            },
            label,
          );
        const l = s.leave?.find((x) => x.id === args["id"]);
        if (l)
          return prepare(
            "adminAddLeave",
            { staffId: s.id, start: l.start, end: l.end, reason: l.reason || "Day off" },
            label,
          );
      }
      return reply("I can't find what was removed, so I can't put it back.");
    }
    if (action === "adminAddClosure") {
      const dates = (args["dates"] as string[] | undefined) ?? [];
      const c = ((await read<{ closures?: Closure[] }>("adminClosures", {})).closures ?? []).find(
        (x) => dates.includes(x.start) && x.reason === args["reason"],
      );
      return c
        ? prepare("adminReopen", { id: c.id }, label)
        : reply("That closure is already gone.");
    }
    if (action === "adminReopen") {
      const c = ((object(before)["closures"] as Closure[] | undefined) ?? []).find(
        (x) => x.id === args["id"],
      );
      return c
        ? prepare(
            "adminAddClosure",
            { kind: "days", start: c.start, end: c.end ?? c.start, reason: c.reason || "Closed" },
            label,
          )
        : reply("I can't find that closure's details, so I can't put it back.");
    }
    if (action === "adminUpsertBooking") {
      const ref = String(args["reference"] ?? "");
      if (ref === "new" || args["insert"]) {
        const made = String(object(object(last["result"])["result"])["reference"] ?? "");
        return made
          ? prepare(
              "adminUpsertBooking",
              {
                reference: made,
                patch: {
                  status: "cancelled",
                  meta: { status: "cancelled" },
                  cancelReason: "Undone in the assistant",
                },
              },
              label,
            )
          : reply("I can't tell which booking was made, so I can't undo it.");
      }
      const was = object(object(before)["booking"]);
      const patch = object(args["patch"]);
      if (patch["date"] || patch["time"] != null)
        return prepare(
          "adminUpsertBooking",
          { reference: ref, patch: { date: was["date"], time: was["time"] } },
          label,
        );
      if (patch["status"] === "cancelled")
        return prepare(
          "adminUpsertBooking",
          {
            reference: ref,
            patch: {
              status: "confirmed",
              meta: {
                status: was["status"] === "cancelled" ? "upcoming" : (was["status"] ?? "upcoming"),
              },
            },
          },
          label,
        );
      if (object(patch["meta"])["status"])
        return prepare(
          "adminUpsertBooking",
          { reference: ref, patch: { meta: { status: was["status"] ?? "upcoming" } } },
          label,
        );
    }
    if (action === "adminSaveService") {
      const s = ((object(before)["services"] as Svc[] | undefined) ?? []).find(
        (x) => x.id === args["id"],
      );
      if (s)
        return prepare(
          "adminSaveService",
          {
            id: s.id,
            categoryId: s.categoryId,
            name: s.name,
            description: s.description,
            minutes: s.minutes,
            price: s.price,
            from: s.from,
            order: s.order,
            active: s.active,
            buffer: s.buffer,
            featured: s.featured,
          },
          label,
        );
    }
    return reply(
      "That change can't be undone automatically. Please change it from the admin pages.",
    );
  }
}
