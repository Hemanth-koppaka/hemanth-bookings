/**
 * Admin assistant: intent resolver.
 *
 * Decides WHAT the admin means before anything is looked up: first the domain
 * (blocks / availability, bookings, staff, services, reports), then the action
 * (look up, create, remove, change), then the details (people, dates, times).
 * A whole sentence is never used as a search term: only a short, name-like
 * phrase goes to customer search, and anything unclear gets a short question.
 *
 * Free and deterministic (no AI service). `Memory` is the short-lived context
 * of the open assistant window (last stylist, date, numbered results); it only
 * points at records, which the server re-reads before preparing any change.
 */
import type { Audience, Category } from "./salon";
import {
  addDays,
  audienceWord,
  blank,
  findDates,
  findPeriod,
  findPhone,
  findRef,
  findServices,
  findTimes,
  leftoverName,
  nameMatches,
  norm,
  parseCommand,
  tidy,
  type Intent as Classic,
  type Range,
  type Who,
} from "./assistant-commands";

export type Staff = { id: string; name: string };
export type RefKind = "block" | "staffBlock" | "leave" | "closure" | "booking";
export type Ref = { type: RefKind; id: string; label: string; staffId?: string };
export type Memory = {
  staff?: Staff;
  date?: string;
  range?: Range;
  list?: Ref[];
  /** the last look-up, so "what about Saturday?" can repeat it for another day */
  last?: Resolved;
  /** a question the assistant just asked: "which hours?" for a stylist block */
  awaiting?: "staffHours";
};

export type Resolved =
  | { kind: "help" }
  | { kind: "clarify"; question: string; date?: string; staff?: Staff }
  | { kind: "undo" }
  /** everything unavailable: salon blocks/breaks, closures, stylist blocks and leave */
  | { kind: "unavailable"; range: Range; staff: Staff | null; scope: "all" | "closures"; defaultRange: boolean }
  | { kind: "available"; date: string | null; staff: Staff }
  | { kind: "working"; date: string }
  | { kind: "schedule"; date: string; staff: Staff }
  | { kind: "onLeave"; range: Range }
  | { kind: "staffBlock"; staff: Staff; date: string; start: number; end: number; reason: string }
  | { kind: "staffLeave"; staff: Staff; dates: string[]; reason: string }
  | { kind: "remove"; target: RemoveTarget }
  | { kind: "bookings"; range: Range; staff: Staff | null; time: number | null; count: boolean }
  | { kind: "bookingNo"; no: number; then: "show" | "cancel"; reason: string }
  | { kind: "nextFor"; name: string }
  | { kind: "report"; range: Range; metric: "revenue" | "completed" | "customers" | "all" }
  | { kind: "servicePrice"; serviceIds: string[]; text: string }
  | { kind: "serviceList"; active: boolean }
  | { kind: "pick"; index: number; action: "remove" | "cancel" | "show" }
  | { kind: "navigate"; page: Page; date: string | null; name: string | null }
  | Classic;

export type Page = "dashboard" | "calendar" | "appointments" | "customers" | "services" | "reports" | "activity" | "closures" | "staff" | "rules" | "settings" | "notifications" | "content" | "system";

const PAGES: [RegExp, Page][] = [
  [/\b(calendar|diary)\b/, "calendar"],
  [/\b(appointments?|bookings?) (page|list|screen|tab)\b|\bappointments\b/, "appointments"],
  [/\b(customers?|clients?)( page| list| profile| details)?\b/, "customers"],
  [/\b(services?|menu|prices?|price list)\b/, "services"],
  [/\b(reports?|analytics|revenue report|earnings report|stats|statistics)\b/, "reports"],
  [/\b(activity|history|logs?|audit)\b/, "activity"],
  [/\b(closures?|holidays?)\b/, "closures"],
  [/\b(staff|stylists?|team)\b/, "staff"],
  [/\b(booking )?rules\b/, "rules"],
  [/\b(settings|preferences)\b/, "settings"],
  [/\b(notifications?|alerts?|messages)\b/, "notifications"],
  [/\b(content|website|site|pages?)\b/, "content"],
  [/\b(system|health)\b/, "system"],
  [/\b(dashboard|home|overview)\b/, "dashboard"],
];

export type RemoveTarget = {
  /** a numbered item from the last list */
  ref?: Ref;
  /** what to look for otherwise */
  scope: "any" | "salon" | "staff" | "closure";
  staff: Staff | null;
  date: string | null;
  time: number | null;
  period: { start: number; end: number } | null;
};

export type Ctx = {
  today: string;
  menus: { men: Category[]; women: Category[] };
  staff: Staff[];
  memory?: Memory;
};

const has = (t: string, re: RegExp) => re.test(t);
const dow = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const day = (iso: string, label?: string): Range => ({ from: iso, to: iso, label: label ?? iso });

/** "this week", "next week", "this weekend", "this month", or the dates mentioned. */
function rangeFrom(t: string, today: string, dates: string[]): Range | null {
  const monday = addDays(today, -((dow(today) + 6) % 7));
  if (/\bnext week\b/.test(t)) return { from: addDays(monday, 7), to: addDays(monday, 13), label: "next week" };
  if (/\b(this |the )?weekend\b/.test(t)) {
    const sat = addDays(today, (6 - dow(today) + 7) % 7);
    return dow(today) === 0 ? day(today, "this weekend") : { from: sat, to: addDays(sat, 1), label: "this weekend" };
  }
  if (/\b(this|current) week\b|\bweek\b/.test(t)) return { from: monday, to: addDays(monday, 6), label: "this week" };
  if (/\b(next|coming) month\b/.test(t)) {
    const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
    const start = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    const end = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
    return { from: start, to: end, label: "next month" };
  }
  if (/\b(this|current) month\b|\bmonth\b/.test(t)) {
    const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
    return { from: `${today.slice(0, 8)}01`, to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10), label: "this month" };
  }
  if (dates.length) {
    const s = [...dates].sort();
    return { from: s[0]!, to: s[s.length - 1]!, label: s.length === 1 ? (s[0] === today ? "today" : s[0]!) : `${s[0]} – ${s[s.length - 1]}` };
  }
  return null;
}

const ORDINALS: [RegExp, number][] = [
  [/\b(first|1st|one|top)\b/, 0], [/\b(second|2nd|two)\b/, 1], [/\b(third|3rd|three)\b/, 2],
  [/\b(fourth|4th|four)\b/, 3], [/\b(fifth|5th|five)\b/, 4], [/\b(sixth|6th|six)\b/, 5],
];
/** "the first one", "number 2", "#3", "the last one" (only meaningful after a numbered list) */
function ordinal(t: string, count: number): number | null {
  if (/\b(last|final|bottom)\b( one)?/.test(t)) return count ? count - 1 : null;
  const n = /(?:#|\bno\.?\s*|\bnumber\s+|\bitem\s+)(\d{1,2})\b/.exec(t);
  if (n) return Number(n[1]) - 1;
  for (const [re, i] of ORDINALS) if (re.test(t) && /\b(one|block|item|booking|closure|entry|it)\b|\b(first|second|third|fourth|fifth|last)\b/.test(t)) return i;
  return null;
}

const GENERIC = new Set(["stylist", "stylists", "male", "female", "senior", "junior", "artist", "the", "salon", "staff", "team", "any", "mr", "mrs", "ms"]);

function findStaff(raw: string, staff: Staff[], memory: Memory | undefined): Staff | null {
  const n = ` ${norm(raw)} `;
  const hit = staff.find((st) => {
    const parts = norm(st.name).split(" ").filter((w) => w.length > 2 && !GENERIC.has(w));
    return parts.some((w) => n.includes(` ${w} `) || n.includes(` ${w}s `));
  });
  if (hit) return hit;
  // "him", "her", "them", "he", "she": the stylist we were just talking about
  if (memory?.staff && /\b(him|her|them|he|she|his|their)\b/.test(n)) return memory.staff;
  return null;
}

/** Remove stylist names (and "'s") so they are never mistaken for a customer. */
function withoutStaff(raw: string, staff: Staff[]): string {
  let s = raw;
  for (const st of staff)
    for (const w of norm(st.name).split(" ").filter((x) => x.length > 2 && !GENERIC.has(x)))
      s = s.replace(new RegExp(`\\b${w}(['’]s)?\\b`, "gi"), " ");
  return s;
}

const Q = /\b(which|what|whats|show|list|any|see|view|check|tell|did|have|has|are|is|was|were|when|how many|how much|who|whom|do|does)\b|\?/;
const BLOCK = /\b(block|blocks|blocked|blocking|unavailable|not available|busy|hold|held|time off|day off|off|leave|closure|closures|closed|holiday|holidays|unavailability)\b/;
const REMOVE = /\b(remove|delete|cancel|unblock|un-block|clear|undo|drop|take off|reopen|re-open|open again|lift)\b/;

export function resolve(input: string, ctx: Ctx): Resolved {
  const raw = tidy(input);
  const t = ` ${raw.toLowerCase()} `;
  const mem = ctx.memory;
  if (!raw || /^\s*(help|\?|what can you do|commands|options)\s*\??\s*$/i.test(raw)) return { kind: "help" };
  if (/^\s*(undo|undo (that|it|the last( one| change)?)|revert( that| it)?|go back|reverse (that|it))\s*$/i.test(raw)) return { kind: "undo" };

  const datesF = findDates(raw, ctx.today);
  const dates = [...new Set(datesF.map((d) => d.value))];
  const timesF = findTimes(blank(raw, datesF));
  const times = timesF.map((x) => x.value);
  const period = findPeriod(t);
  const staff = findStaff(raw, ctx.staff, mem);
  const range = rangeFrom(t, ctx.today, dates);
  const asking = Q.test(t);
  const reasonOf = () =>
    /\b(?:for|because|reason|as)\s+([a-z][^,.;?]*)$/i.exec(blank(raw, [...datesF, ...timesF]))?.[1]?.trim() ?? "";

  // ── the answer to "which hours should Kiran be blocked?" ──
  if (mem?.awaiting === "staffHours" && mem.staff && mem.date && (times.length || period) && !REMOVE.test(t)) {
    if (period && period.label === "the whole day" && !times.length)
      return { kind: "staffLeave", staff: mem.staff, dates: [mem.date], reason: reasonOf() || "Day off" };
    const start = times[0] ?? period!.start;
    const end = times[1] ?? (times[0] != null ? times[0] + 60 : period!.end);
    return { kind: "staffBlock", staff: mem.staff, date: mem.date, start: Math.min(start, end), end: Math.max(start, end), reason: reasonOf() || "Not available" };
  }

  // ── navigation: "open my calendar", "take me to today's appointments", "show activity history" ──
  if (/^\s*(please\s+)?(open|go to|goto|take me to|navigate to|bring up|jump to|switch to)\b|\b(open|show) (the |my )?\w+ (page|screen|tab)\b|^\s*show (me )?(the )?(activity|history|logs?|audit)\b/i.test(raw)) {
    const hit = PAGES.find(([re]) => re.test(t));
    if (hit) {
      const nm = hit[1] === "customers" ? leftoverName(withoutStaff(raw, ctx.staff), [], []).replace(/\b(Open|Go|Take|Me|Navigate|Customer|Customers|Client|Details|Profile|Page|Of|For|To|Show|Bring|Up)\b/g, "").replace(/\s+/g, " ").trim() : "";
      return { kind: "navigate", page: hit[1], date: dates[0] ?? (range && range.from === range.to ? range.from : null), name: nm || null };
    }
  }

  // ── follow-ups on the last numbered list: "remove the first one", "cancel #2" ──
  const list = mem?.list ?? [];
  // "booking number 5" is a booking's own number, never "item 5 of the last list"
  const ownNumber = /\b(booking|appointment|appt|bkg)\s*(no\.?|number|#)\s*#?\d|\b(booking|appointment)\s+#?\d/i.test(raw);
  if (list.length && !ownNumber) {
    const i = ordinal(t, list.length);
    if (i != null && (REMOVE.test(t) || /\b(show|open|details?)\b/.test(t))) {
      if (i < 0 || i >= list.length) return { kind: "clarify", question: `There ${list.length === 1 ? "is only 1 item" : `are only ${list.length} items`} in the last list. Which one?` };
      const ref = list[i]!;
      if (ref.type === "booking") return /\b(show|open|details?)\b/.test(t) && !REMOVE.test(t) ? { kind: "pick", index: i, action: "show" } : { kind: "pick", index: i, action: "cancel" };
      return { kind: "remove", target: { ref, scope: "any", staff: null, date: null, time: null, period: null } };
    }
  }

  // ── "what about Saturday?": the last look-up again, for another day ──
  if (mem?.last && /^\s*(and |but )?(what|how) about\b|^\s*(and|also) (on |for )?\b/i.test(raw) && (dates.length || range)) {
    const d = dates[0] ?? range?.from ?? ctx.today;
    const r = range ?? day(d, d === ctx.today ? "today" : d);
    const L = mem.last;
    const who = staff ?? ("staff" in L ? (L.staff as Staff | null) : null);
    if (L.kind === "schedule" && who) return { kind: "schedule", date: d, staff: who };
    if (L.kind === "available" && who) return { kind: "available", date: d, staff: who };
    if (L.kind === "working") return { kind: "working", date: d };
    if (L.kind === "unavailable") return { ...L, range: r, staff: who, defaultRange: false };
    if (L.kind === "bookings") return { ...L, range: r, staff: who };
    if (L.kind === "report") return { ...L, range: r };
  }

  // ── services: prices, active / inactive ──
  if (has(t, /\b(price|prices|cost|costs|rate|rates|charge|charges|fee|how much is|how much does)\b/) || /\b(change|set|make|update)\b.*\bto\s*(₹|rs\.?|rupees)?\s*\d{2,6}\b(?!\s*(am|pm|:))/.test(t)) {
    const svc = findServices(raw, ctx.menus, audienceWord(t));
    const change = has(t, /\b(change|set|make|update|increase|raise|reduce|lower|to)\b/) && /\d{2,6}/.test(raw);
    if (change) {
      const c = parseCommand(raw, { today: ctx.today, menus: ctx.menus, staff: [] });
      if (c.kind === "price") return c;
      const m = /(?:₹|rs\.?|rupees?)?\s*\b(\d{2,6})\b(?!\s*(?:am|pm|min|hr|:))/i.exec(raw.slice(Math.max(0, raw.toLowerCase().lastIndexOf(" to "))));
      if (m && svc.ids.length) return { kind: "price", serviceIds: svc.ids, audience: svc.audience, price: Number(m[1]) };
      return { kind: "clarify", question: "Which service, and what new price? e.g. “change Beard Trim to ₹350”." };
    }
    if (svc.ids.length) return { kind: "servicePrice", serviceIds: svc.ids, text: raw };
    if (has(t, /\bprices?\b/)) return { kind: "serviceList", active: true };
  }
  if (has(t, /\b(services|menu)\b/) && (asking || has(t, /\b(active|inactive|hidden|disabled|off|switched off|turned off|on)\b/)))
    return { kind: "serviceList", active: !has(t, /\b(inactive|hidden|disabled|switched off|turned off|not active|archived)\b/) };

  // ── reports: earnings, completed visits, customers ──
  if (has(t, /\b(earn|earned|earning|earnings|revenue|income|sales|money|made|collection|collected|business|turnover)\b/) ||
      (has(t, /\bhow many\b/) && has(t, /\b(completed|done|finished|customers|clients|visited|visits|came)\b/))) {
    const metric = has(t, /\bcustomers?|clients?|visited|people\b/) ? "customers" : has(t, /\b(completed|done|finished)\b/) && !has(t, /\b(earn|revenue|money|made)\b/) ? "completed" : has(t, /\b(earn|earned|earning|earnings|revenue|income|sales|money|made|collection|collected|turnover)\b/) ? "revenue" : "all";
    return { kind: "report", range: range ?? day(ctx.today, "today"), metric };
  }

  // ── staff: who is working, schedules, leave ──
  if (has(t, /\bwho('s| is| are)? (working|in|on duty|available|free|present)\b|\bwho works\b/))
    return { kind: "working", date: dates[0] ?? range?.from ?? ctx.today };
  if (has(t, /\b(on leave|off this|off next|taking leave|absent)\b/) && has(t, /\bwho\b/))
    return { kind: "onLeave", range: range ?? { from: ctx.today, to: addDays(ctx.today, 6), label: "the next 7 days" } };
  if (staff && has(t, /\b(schedule|shift|timings?|hours|working hours|day|plan|diary|calendar)\b/) && !has(t, /\b(block|unblock|off|leave|book|appointments?|bookings?)\b/))
    return { kind: "schedule", date: dates[0] ?? range?.from ?? mem?.date ?? ctx.today, staff };
  if (staff && has(t, /\b(available|free|working|in today|in tomorrow|coming in)\b/) && !has(t, /\bnot (available|free)\b/) && (asking || has(t, /\bwhen\b/)))
    return { kind: "available", date: dates[0] ?? range?.from ?? null, staff };

  // ── blocks, closures, time off ──
  const blockish = BLOCK.test(t) || has(t, /\bunavailable|not available|closures?\b/);
  if (blockish || has(t, /\b(unblock|un-block|reopen|re-open)\b/) || (REMOVE.test(t) && has(t, /\b(block|closure|holiday|leave)\b/))) {
    // remove / unblock / reopen
    if (REMOVE.test(t) && !has(t, /\b(book|booking|appointment)\b/)) {
      const scope: RemoveTarget["scope"] = has(t, /\b(closure|holiday|reopen|re-open|open again|closed)\b/) ? "closure" : staff ? "staff" : has(t, /\bsalon\b/) ? "salon" : "any";
      if (has(t, /\b(reopen|re-open|open again)\b/) && !dates.length && !range) return { kind: "clarify", question: "Which date should I reopen? e.g. “reopen the salon tomorrow”." };
      return { kind: "remove", target: { scope, staff, date: dates[0] ?? (range && range.from === range.to ? range.from : null), time: times[0] ?? null, period } };
    }
    // look-ups: "which timings I blocked?", "when is Kiran unavailable?", "show all salon closures"
    const createVerb = /^\s*(please\s+)?(block|close|hold|keep|mark|put|give|set|make)\b/i.test(raw) || has(t, /\b(can you|could you|please|i want to|need to)\s+(block|close|keep|mark|hold)\b/);
    if ((asking && !createVerb) || (!createVerb && !times.length && !period && !dates.length) || has(t, /^\s*(show|list|view|see)\b/)) {
      const closuresOnly = has(t, /\b(closures?|holidays?|closed days?|when (is|are) (we|the salon) closed)\b/) && !staff;
      const r = range ?? (closuresOnly ? { from: ctx.today, to: addDays(ctx.today, 365), label: "the coming year" } : { from: addDays(ctx.today, -30), to: addDays(ctx.today, 60), label: "the last 30 days and the next 60 days" });
      return { kind: "unavailable", range: r, staff, scope: closuresOnly ? "closures" : "all", defaultRange: !range };
    }
    // a stylist's time off
    if (staff) {
      const d = dates.length ? dates : mem?.date && /\b(him|her|them|he|she)\b/.test(t) ? [mem.date] : [];
      if (!d.length) return { kind: "clarify", question: `Which day should ${staff.name} be unavailable? e.g. “block ${staff.name.split(" ")[0]} tomorrow from 2 to 4 pm”.` };
      const start = times[0] ?? period?.start ?? null;
      const end = times[1] ?? (times[0] != null ? times[0] + 60 : period?.end ?? null);
      if (start != null && end != null)
        return { kind: "staffBlock", staff, date: d[0]!, start: Math.min(start, end), end: Math.max(start, end), reason: reasonOf() || "Not available" };
      // "block Kiran tomorrow" without hours: ask, rather than guess a whole day off
      if (has(t, /\bblock\b/) && !has(t, /\b(off|leave|holiday|whole day|full day|all day|entire day|day off)\b/))
        return { kind: "clarify", question: `Which hours should ${staff.name} be blocked on ${d[0]}? e.g. “from 2 to 4 pm”, or say “the whole day”.`, date: d[0]!, staff } as Resolved;
      return { kind: "staffLeave", staff, dates: d, reason: reasonOf() || "Day off" };
    }
    // the whole salon: a day (closure) or some hours (block)
    if (!times.length && !period && dates.length && has(t, /\b(close|closed|block|holiday|shut)\b/)) {
      return { kind: "close", dates, reason: reasonOf() || "Closed" };
    }
    const classic = parseCommand(raw, { today: ctx.today, menus: ctx.menus, staff: [] });
    if (classic.kind === "block") return classic;
    if (classic.kind === "close") return classic;
    return { kind: "clarify", question: "Which day and times? e.g. “block tomorrow 2 to 4 pm for training” or “close the salon on Friday”." };
  }

  // ── bookings ──
  const bookingNo = /\b(?:booking|appointment|appt|bkg)\s*(?:no\.?|number|#)?\s*#?(\d{1,4})\b|#(\d{1,4})\b/i.exec(raw);
  if (bookingNo && !findPhone(raw)) {
    const no = Number(bookingNo[1] ?? bookingNo[2]);
    return { kind: "bookingNo", no, then: REMOVE.test(t) ? "cancel" : "show", reason: /\b(?:because|reason)\s+(.+)$/i.exec(raw)?.[1]?.trim() ?? "" };
  }
  const classic = parseCommand(withoutStaff(raw, staff ? [staff] : []), { today: ctx.today, menus: ctx.menus, staff: [] });
  if (["book", "move", "cancel", "status"].includes(classic.kind)) {
    // a pronoun or a stylist name is not a customer: keep only a real customer reference
    const c = classic as Extract<Classic, { kind: "move" | "cancel" | "status" }>;
    if ("who" in c && !c.who.ref && !c.who.name && mem?.list?.length === 1 && mem.list[0]!.type === "booking")
      return { ...c, who: { ref: mem.list[0]!.id } as Who };
    return classic;
  }
  if (has(t, /\b(next|upcoming)\b/) && has(t, /\b(appointment|booking|visit)\b/)) {
    const name = leftoverName(withoutStaff(raw, ctx.staff), [], []).replace(/\b(Next|Upcoming|Appointment|Booking|Visit|Find|Show|When|Is)\b/g, "").replace(/\s+/g, " ").trim();
    if (name) return { kind: "nextFor", name };
  }
  if (has(t, /\b(bookings?|appointments?|appts?|booked|coming|clients?|customers?|scheduled|visits?)\b/) || (asking && has(t, /\bwho\b/))) {
    if (classic.kind === "find" || classic.kind === "customer") return classic;
    return {
      kind: "bookings",
      range: range ?? (staff && !dates.length ? { from: ctx.today, to: addDays(ctx.today, 13), label: "the next 2 weeks" } : day(ctx.today, "today")),
      staff,
      time: times[0] ?? null,
      count: has(t, /\bhow many\b|\bcount\b|\bnumber of\b/),
    };
  }

  // ── everything else the classic reader knows (free slots, day lists, customers, …) ──
  if (classic.kind === "free" && staff) return { kind: "available", date: classic.date, staff };
  if (classic.kind !== "unknown") return classic;
  return { kind: "clarify", question: clarifyFor(t) };
}

function clarifyFor(t: string): string {
  if (/\b(block|break|busy|off|leave)\b/.test(t)) return "Do you want to see blocked times or block a time? e.g. “which timings did I block?” or “block tomorrow 2 to 4 pm”.";
  if (/\b(book|appoint)/.test(t)) return "Do you want to see bookings or make one? e.g. “who is booked today?” or “book Ravi 9876543210 haircut tomorrow 4 pm”.";
  if (/\b(staff|stylist|working)\b/.test(t)) return "Which stylist and day? e.g. “show Meera's schedule tomorrow” or “who is working tomorrow?”.";
  return "Sorry, I didn't get that. You can ask things like “which timings did I block?”, “who is booked today?”, “how much did we earn this week?” or “block Kiran tomorrow 2 to 4 pm”.";
}

export { nameMatches, findRef };
