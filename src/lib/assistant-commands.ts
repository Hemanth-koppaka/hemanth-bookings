/**
 * Admin assistant: turns a typed (or dictated) command into one exact intent.
 *
 * Free and offline: plain pattern matching, no AI service. Anything that
 * changes data is only ever *proposed* here; the console shows it and the
 * owner confirms before the normal admin functions run it.
 */
import type { Audience, Category } from "./salon";

export type StatusWord = "arrived" | "in-chair" | "completed" | "no-show";
export type Who = { ref?: string; name?: string; date?: string; time?: number };
export type Range = { from: string; to: string; label: string };

export type Intent =
  | { kind: "help" }
  | { kind: "day"; date: string }
  | { kind: "at"; date: string; time: number }
  | { kind: "summary"; range: Range }
  | { kind: "free"; date: string; audience: Audience; serviceIds: string[] }
  | { kind: "find"; name: string }
  | {
      kind: "book";
      name: string;
      phone: string;
      audience: Audience;
      serviceIds: string[];
      date: string | null;
      time: number | null;
    }
  | { kind: "move"; who: Who; date: string | null; time: number | null }
  | { kind: "cancel"; who: Who; reason: string }
  | { kind: "status"; who: Who; status: StatusWord }
  | { kind: "block"; date: string; start: number; end: number; reason: string }
  | { kind: "close"; dates: string[]; reason: string }
  | { kind: "blocks"; range: Range }
  | { kind: "unblock"; date: string; time: number | null }
  | { kind: "reopen"; date: string }
  | {
      kind: "staffOff";
      staffId: string;
      staffName: string;
      dates: string[];
      start: number | null;
      end: number | null;
      reason: string;
    }
  | { kind: "price"; serviceIds: string[]; audience: Audience | null; price: number }
  | { kind: "customer"; name: string }
  | { kind: "unknown"; hint: string };

export type Ctx = {
  /** salon's "today", yyyy-mm-dd */
  today: string;
  menus: { men: Category[]; women: Category[] };
  /** stylists, so "Kiran off tomorrow" means a stylist, not a customer */
  staff?: { id: string; name: string }[];
};

/* ── everyday shorthand ────────────────────────────────────── */

/** Spelling shortcuts people type or dictation produces. */
export function tidy(input: string): string {
  return input
    .replace(
      /\b(tmrw|tmr|tmw|tomo|tomoro|tomorow|tommorow|tommorrow|2moro|2morrow|2mrw)\b/gi,
      "tomorrow",
    )
    .replace(/\b(tdy|tday|2day|todays)\b/gi, "today")
    .replace(/\bnxt\b/gi, "next")
    .replace(/\b(\d{1,2})\s*o'?\s*clock\b/gi, "$1")
    .replace(/\b([ap])\s*\.?\s*m\b\.?/gi, "$1m")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!]+$/, "")
    .trim();
}

/** "morning", "afternoon", "evening": the salon's day in three parts. */
export function findPeriod(t: string): { start: number; end: number; label: string } | null {
  if (/\b(whole|full|entire|all) day\b/.test(t))
    return { start: 600, end: 1200, label: "the whole day" };
  if (/\bmorning\b/.test(t)) return { start: 600, end: 780, label: "the morning" };
  if (/\b(afternoon|after lunch)\b/.test(t))
    return { start: 840, end: 1020, label: "the afternoon" };
  if (/\b(evening|night)\b/.test(t)) return { start: 1020, end: 1200, label: "the evening" };
  return null;
}

/* ── dates ─────────────────────────────────────────────────── */

const DAY = 86_400_000;
export const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const dow = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const WEEKDAY_RE =
  "(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)";

/** A day-month (no year): this year, or next year if it has already passed. */
function dayMonth(today: string, d: number, m: number): string | null {
  if (d < 1 || d > 31 || m < 0 || m > 11) return null;
  let y = Number(today.slice(0, 4));
  const iso = (yy: number) =>
    `${yy}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (iso(y) < addDays(today, -1)) y++;
  const out = iso(y);
  return Number.isNaN(Date.parse(`${out}T00:00:00Z`)) ? null : out;
}

type Found<T> = { value: T; start: number; end: number };

/** Every date mentioned, in order (spans let the caller remove them from the text). */
export function findDates(text: string, today: string): Found<string>[] {
  const out: Found<string>[] = [];
  const add = (re: RegExp, f: (m: RegExpExecArray) => string | null) => {
    for (const m of text.matchAll(new RegExp(re.source, "gi"))) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (out.some((o) => start < o.end && o.start < end)) continue;
      const v = f(m as RegExpExecArray);
      if (v) out.push({ value: v, start, end });
    }
  };
  add(/\b(\d{4})-(\d{2})-(\d{2})\b/, (m) => `${m[1]}-${m[2]}-${m[3]}`);
  add(/\bday after tomorrow\b/, () => addDays(today, 2));
  add(/\b(today|tonight)\b/, () => today);
  add(/\b(tomorrow|tmrw|tmr)\b/, () => addDays(today, 1));
  add(/\byesterday\b/, () => addDays(today, -1));
  add(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+${MONTH_RE}\\b`), (m) =>
    dayMonth(today, Number(m[1]), MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase())),
  );
  add(new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`), (m) =>
    dayMonth(today, Number(m[2]), MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase())),
  );
  add(/\b(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2})\b/, (m) => {
    const iso = `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
    return Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) ? null : iso;
  });
  add(/\b(\d{1,2})\/(\d{1,2})\b/, (m) => dayMonth(today, Number(m[1]), Number(m[2]) - 1));
  add(new RegExp(`\\b(next\\s+|this\\s+|on\\s+)?${WEEKDAY_RE}\\b`), (m) => {
    const want = WEEKDAYS.indexOf(m[2]!.slice(0, 3).toLowerCase());
    let n = (want - dow(today) + 7) % 7;
    if (n === 0 && /next/i.test(m[1] ?? "")) n = 7;
    return addDays(today, n);
  });
  return out.sort((a, b) => a.start - b.start);
}

/* ── times ─────────────────────────────────────────────────── */

/** Salon hours are 10 AM to 8 PM, so a bare "4" means 4 PM and "10" means 10 AM. */
function hourOf(h: number, mer: string | undefined): number | null {
  const ap = mer?.replace(/\./g, "").toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  else if (ap === "am" && h === 12) h = 0;
  else if (!ap && h >= 1 && h <= 8) h += 12;
  return h >= 0 && h <= 23 ? h : null;
}

export function findTimes(text: string): Found<number>[] {
  const out: Found<number>[] = [];
  const re =
    /\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?=$|[\s,;!?)]|\b)|\b(noon|midday)\b/gi;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (m[4]) {
      out.push({ value: 12 * 60, start, end });
      continue;
    }
    const before = text.slice(Math.max(0, start - 12), start).toLowerCase();
    // a bare number is only a time next to a time word ("at 4", "4 to 6", "till 5")
    const after = text.slice(end, end + 14).toLowerCase();
    // "2 to 4", "2-4", "at 4", "till 5": a range or a time word makes a bare number a time
    const marked =
      Boolean(m[2] || m[3]) ||
      /\b(at|@|from|to|till|until|by|between|and|-|–)\s*$/.test(before) ||
      /^\s*(to|till|until|and|-|–)\s*\d/.test(after);
    if (!marked) continue;
    const hh = hourOf(Number(m[1]), m[3]);
    const mm = m[2] ? Number(m[2]) : 0;
    if (hh == null || mm > 59) continue;
    out.push({ value: hh * 60 + mm, start, end });
  }
  return out;
}

/* ── services ──────────────────────────────────────────────── */

export const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Everyday words people use for a service, mapped to words in its name. */
const ALIASES: [RegExp, string][] = [
  [/\bhair ?cut\b|\bcutting\b/, "basic haircut"],
  [/\bbeard\b(?! colour| color)/, "beard trim"],
  [/\bsignature\b(?! facial)/, "kirans signature"],
  [/\bkids?\b|\bchild\b/, "kids"],
  [/\bspa\b/, "hair spa"],
  [/\bfacial\b/, "facial"],
  [/\bwash\b/, "wash"],
];

export function findServices(
  text: string,
  menus: Ctx["menus"],
  audience: Audience | null,
): { ids: string[]; audience: Audience | null; spans: [number, number][] } {
  const t = ` ${norm(text)} `;
  const pick = (a: Audience) =>
    menus[a].flatMap((c) => c.services).map((s) => ({ ...s, key: norm(s.name), a }));
  const all = audience ? pick(audience) : [...pick("men"), ...pick("women")];
  const ids: string[] = [];
  let aud: Audience | null = audience;
  const take = (s: { id: string; a: Audience }) => {
    if (aud && s.a !== aud) return;
    aud = s.a;
    if (!ids.includes(s.id)) ids.push(s.id);
  };
  // 1) a service named in full (longest names first, so "hair spa deep conditioning" beats "hair spa")
  let rest = t;
  for (const s of [...all].sort((a, b) => b.key.length - a.key.length)) {
    if (s.key.length > 2 && rest.includes(` ${s.key} `)) {
      take(s);
      rest = rest.replace(` ${s.key} `, " ");
    }
  }
  // 2) everyday words
  for (const [re, key] of ALIASES) {
    if (!re.test(rest)) continue;
    const hits = all.filter((s) => s.key.includes(key) && (!aud || s.a === aud));
    // only when it points to one service (per audience) without guessing
    const first = hits.find((s) => s.a === (aud ?? "men")) ?? hits[0];
    if (first && hits.filter((h) => h.a === first.a).length === 1) take(first);
  }
  return { ids, audience: aud, spans: [] };
}

/* ── names, phone, reference ───────────────────────────────── */

const STOP = new Set(
  (
    "a an the for at on to of in by with and please pls kindly can you could book booking appointment appt " +
    "add new make schedule fix create move shift reschedule change postpone prepone cancel delete remove " +
    "mark set as is has have arrived arrive came come here in chair started start done completed complete " +
    "finished finish no show noshow didnt didn't not today tomorrow tonight from till until " +
    "am pm a.m p.m mins min minutes hr hrs hour hours slot slots time his her their booking's " +
    "mr mrs ms miss sir madam men man gents male women woman lady ladies female girl boy customer client " +
    "phone number contact mobile details email whatsapp give me get send tell show list my our we i timings timing times price cost rate is are was were did do does service services haircut hair cut beard trim shave spa facial wash kids signature find search look up show whats what walk walkin any who"
  ).split(" "),
);

export function findPhone(text: string): Found<string> | null {
  const m = /(?:\+?91[\s-]*)?\b(\d[\d\s-]{8,13}\d)\b/.exec(text);
  if (!m) return null;
  const digits = m[1]!.replace(/\D/g, "");
  if (digits.length !== 10) return null;
  return { value: digits, start: m.index, end: m.index + m[0].length };
}

export function findRef(text: string): string | undefined {
  return /\bBK-?\s?([A-Z0-9]{4,8})\b/i.exec(text)?.[1]?.toUpperCase().replace(/^/, "BK-");
}

/** What's left once dates, times, phone, services and command words are removed. */
export function leftoverName(text: string, cut: [number, number][], services: string[]): string {
  let s = text;
  for (const [a, b] of [...cut].sort((x, y) => y[0] - x[0])) s = s.slice(0, a) + " " + s.slice(b);
  let n = ` ${norm(s.replace(/['’]s\b/gi, ""))} `;
  for (const k of services) n = n.replace(` ${k} `, " ");
  return n
    .split(" ")
    .filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w) && !/^hb[a-z0-9]{4,8}$/.test(w))
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ")
    .trim();
}

/* ── the parser ────────────────────────────────────────────── */

const has = (t: string, re: RegExp) => re.test(t);

export function audienceWord(t: string): Audience | null {
  if (/\b(women|woman|lady|ladies|female|girl|her|mrs|ms|miss|madam)\b/.test(t)) return "women";
  if (/\b(men|man|gents|male|boy|his|mr|sir)\b/.test(t)) return "men";
  return null;
}

export function rangeOf(t: string, today: string, dates: Found<string>[]): Range {
  if (/\b(this|current) week\b|\bweek\b/.test(t)) {
    const start = addDays(today, -((dow(today) + 6) % 7));
    return { from: start, to: addDays(start, 6), label: "this week" };
  }
  if (/\b(this|current) month\b|\bmonth\b/.test(t)) {
    const start = `${today.slice(0, 8)}01`;
    const next = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1));
    return { from: start, to: addDays(next.toISOString().slice(0, 10), -1), label: "this month" };
  }
  const d = dates[0]?.value ?? today;
  return { from: d, to: d, label: d === today ? "today" : d };
}

export function parseCommand(input: string, ctx: Ctx): Intent {
  const raw = tidy(input);
  const t = ` ${raw.toLowerCase().replace(/\s+/g, " ")} `;
  if (!raw || /^\s*(help|\?|what can you do|commands)\b/i.test(raw)) return { kind: "help" };

  const dates = findDates(raw, ctx.today);
  const phone = findPhone(raw);
  const textNoPhone = phone
    ? raw.slice(0, phone.start) + " ".repeat(phone.end - phone.start) + raw.slice(phone.end)
    : raw;
  const times = findTimes(blank(textNoPhone, dates));
  const ref = findRef(raw);
  const refM = /\bBK-?\s?[A-Z0-9]{4,8}\b/i.exec(raw);
  const date = dates[0]?.value ?? null;
  const time = times[0]?.value ?? null;
  const cut: [number, number][] = [
    ...dates.map((d) => [d.start, d.end] as [number, number]),
    ...times.map((x) => [x.start, x.end] as [number, number]),
    ...(phone ? [[phone.start, phone.end] as [number, number]] : []),
    ...(refM ? [[refM.index, refM.index + refM[0].length] as [number, number]] : []),
  ];

  const period = findPeriod(t);
  const ask =
    /\b(which|what|whats|show|list|any|see|view|check|tell|did i|have i|are there|is there|how many)\b|\?/.test(
      t,
    );
  const dateList = [...new Set(dates.map((d) => d.value))];

  // the price of a service: "change haircut price to 600"
  const money = /(?:₹|rs\.?|rupees?|inr)?\s*\b(\d{2,6})\b(?!\s*(?:am|pm|min|hr|:))/i;
  if (
    has(t, /\b(price|cost|rate|charges?|fee)\b/) &&
    has(t, /\b(change|set|make|update|increase|raise|reduce|lower|to)\b/)
  ) {
    const svc = findServices(raw, ctx.menus, audienceWord(t));
    const after = raw.slice(Math.max(raw.toLowerCase().lastIndexOf(" to "), 0));
    const m = money.exec(after) ?? money.exec(raw);
    if (m && svc.ids.length)
      return { kind: "price", serviceIds: svc.ids, audience: svc.audience, price: Number(m[1]) };
    return { kind: "unknown", hint: "price" };
  }

  // a stylist's time off: "Kiran off tomorrow", "Meera not available Friday 2 to 4"
  const stylist = (ctx.staff ?? []).find((st) => {
    const first = norm(st.name).split(" ")[0];
    return first && first.length > 2 && new RegExp(`\\b${first}\\b`).test(norm(raw));
  });
  if (
    stylist &&
    has(t, /\b(off|leave|holiday|not available|unavailable|absent|away|not coming|block|busy)\b/) &&
    !has(t, /\b(book|move|cancel|reschedule)\b/)
  ) {
    const reason =
      /\b(?:for|because|reason)\s+([a-z][^,.;]*)$/i
        .exec(blank(raw, [...dates, ...times]))?.[1]
        ?.trim() ?? "";
    const start = times[0]?.value ?? period?.start ?? null;
    const end = times[1]?.value ?? (times[0] ? times[0].value + 60 : (period?.end ?? null));
    return {
      kind: "staffOff",
      staffId: stylist.id,
      staffName: stylist.name,
      dates: dateList.length ? dateList : [ctx.today],
      start: start != null && end != null ? Math.min(start, end) : null,
      end: start != null && end != null ? Math.max(start, end) : null,
      reason: reason || "Not available",
    };
  }

  // remove a block: "unblock 3 pm today", "remove tomorrow's block"
  if (
    has(
      t,
      /\b(unblock|un-block|(remove|delete|cancel|clear|undo|open up) (the |my |that |this )?(block|blocked|break)|(block|blocked time) (removed?|cancel(led)?))\b/,
    )
  )
    return { kind: "unblock", date: date ?? ctx.today, time };

  // which times are blocked
  if (has(t, /\b(block|blocks|blocked|breaks)\b/) && (ask || (!times.length && !period)))
    return ask || !has(t, /^ ?(block|hold)\b/)
      ? {
          kind: "blocks",
          range: dates.length
            ? {
                from: dates[0]!.value,
                to: dates[dates.length - 1]!.value,
                label: dates[0]!.value === ctx.today ? "today" : dates[0]!.value,
              }
            : /\bweek\b/.test(t)
              ? rangeOf(t, ctx.today, dates)
              : { from: ctx.today, to: addDays(ctx.today, 30), label: "the next 30 days" },
        }
      : { kind: "unknown", hint: "block-time" };

  // reopen after a closure: "reopen 25 dec"
  if (has(t, /\b(reopen|re-open|open again|(cancel|remove|undo) (the )?(holiday|closure|leave))\b/))
    return dates.length
      ? { kind: "reopen", date: dates[0]!.value }
      : { kind: "unknown", hint: "reopen" };

  // close the salon for a day
  if (
    has(t, /\b(close|closed|shut|holiday|leave)\b/) &&
    !has(t, /\b(block|break)\b/) &&
    dates.length
  ) {
    const reason =
      /\b(?:for|because|reason)\s+(.+)$/i.exec(stripDates(raw, dates))?.[1]?.trim() ?? "";
    return {
      kind: "close",
      dates: [...new Set(dates.map((d) => d.value))],
      reason: reason || "Closed",
    };
  }

  // block time
  if (has(t, /\b(block|break|busy|hold)\b/) && (times.length >= 1 || period)) {
    const start = times[0]?.value ?? period!.start;
    const end =
      times[1]?.value ??
      (times[0] ? start + (has(t, /\bhalf an hour|30 ?min/) ? 30 : 60) : period!.end);
    const reason =
      /\b(?:for|because|reason)\s+([a-z][^,.;]*)$/i
        .exec(blank(raw, [...dates, ...times]))?.[1]
        ?.trim() ?? "";
    return {
      kind: "block",
      date: date ?? ctx.today,
      start: Math.min(start, end),
      end: Math.max(start, end),
      reason: reason || (has(t, /\bbreak\b/) ? "Break" : "Blocked"),
    };
  }

  // status changes
  const status: StatusWord | null = has(
    t,
    /\b(no ?-?show|didn'?t come|did not come|not come|not coming)\b/,
  )
    ? "no-show"
    : has(t, /\b(in (the )?chair|started|start)\b/)
      ? "in-chair"
      : has(t, /\b(done|completed?|finished|finish)\b/)
        ? "completed"
        : has(t, /\b(arrived|arrive|is here|came|has come|checked in|check in)\b/)
          ? "arrived"
          : null;
  if (status && !has(t, /\b(cancel|book|move|reschedule)\b/)) {
    const name = leftoverName(raw, cut, []);
    return { kind: "status", who: who(ref, name, date, time), status };
  }

  // cancel
  if (has(t, /\b(cancel|delete|remove)\b/)) {
    const reasonM = /\b(?:because|reason|as)\s+(.+)$/i.exec(raw);
    const base = reasonM ? raw.slice(0, reasonM.index) : raw;
    const name = leftoverName(
      base,
      cut.filter(([a]) => a < base.length),
      [],
    );
    return { kind: "cancel", who: who(ref, name, date, time), reason: reasonM?.[1]?.trim() ?? "" };
  }

  // move / reschedule: "move Ravi (from 4) to 5 tomorrow"
  if (has(t, /\b(move|shift|reschedule|change|postpone|prepone|push)\b/)) {
    const toIdx = t.search(/\bto\b/);
    const after = (x: { start: number }) => toIdx < 0 || x.start + 1 >= toIdx;
    const newTime = [...times].reverse().find(after)?.value ?? null;
    const newDate = [...dates].reverse().find(after)?.value ?? null;
    const oldTime = times.find((x) => !after(x))?.value;
    const oldDate = dates.find((x) => !after(x))?.value;
    const name = leftoverName(raw, cut, []);
    return {
      kind: "move",
      who: who(ref, name, oldDate ?? undefined, oldTime),
      date: newDate,
      time: newTime,
    };
  }

  // new booking
  if (
    has(t, /\b(book|add|new booking|new appointment|schedule|walk ?-?in)\b/) &&
    !has(t, /\b(free|available|availability|slots?)\b/)
  ) {
    const svc = findServices(raw, ctx.menus, audienceWord(t));
    const keys = svc.ids
      .map((id) =>
        [...ctx.menus.men, ...ctx.menus.women].flatMap((c) => c.services).find((s) => s.id === id),
      )
      .filter(Boolean)
      .map((s) => norm(s!.name));
    return {
      kind: "book",
      name: leftoverName(raw, cut, keys),
      phone: phone?.value ?? "",
      audience: svc.audience ?? audienceWord(t) ?? "men",
      serviceIds: svc.ids,
      date,
      time,
    };
  }

  // a customer's phone or details: "Kumar's phone number"
  if (
    has(t, /\b(phone|number|contact|mobile|details|email|whatsapp)\b/) &&
    !has(t, /\b(book|move|cancel)\b/)
  ) {
    const n = leftoverName(raw, cut, [])
      .replace(/\b(Phone|Number|Contact|Mobile|Details|Email|Whatsapp|Give|Me|Get|Send)\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (n) return { kind: "customer", name: n };
  }

  // free slots
  if (has(t, /\b(free|available|availability|open slots?|slots?|vacant|empty)\b/)) {
    const svc = findServices(raw, ctx.menus, audienceWord(t));
    return {
      kind: "free",
      date: date ?? ctx.today,
      audience: svc.audience ?? audienceWord(t) ?? "men",
      serviceIds: svc.ids,
    };
  }

  // money and counts
  if (
    has(
      t,
      /\b(earn|earning|earnings|revenue|sales|income|money|collection|made|how many|count|total|business)\b/,
    )
  )
    return { kind: "summary", range: rangeOf(t, ctx.today, dates) };

  // who is at a time
  if (time != null && has(t, /\b(who|whose|which|at|booked)\b/))
    return { kind: "at", date: date ?? ctx.today, time };

  // a day's list
  if (date || has(t, /\b(bookings?|appointments?|schedule|day|list|show)\b/))
    return { kind: "day", date: date ?? ctx.today };

  // a customer
  const name = leftoverName(raw, cut, []);
  if (ref) return { kind: "find", name: ref };
  const wordCount = raw.split(" ").filter(Boolean).length;
  if (
    name &&
    (has(
      t,
      /\b(find|search|look ?up|where is|when is|booking (of|for)|appointment (of|for)|'s (booking|appointment|visit)|coming)\b/,
    ) ||
      wordCount <= 2)
  )
    return { kind: "find", name };
  return { kind: "unknown", hint: raw };
}

function who(
  ref: string | undefined,
  name: string,
  date?: string | null,
  time?: number | null,
): Who {
  return {
    ...(ref ? { ref } : {}),
    ...(name ? { name } : {}),
    ...(date ? { date } : {}),
    ...(time != null ? { time } : {}),
  };
}

export function blank(text: string, spans: { start: number; end: number }[]) {
  let s = text;
  for (const x of spans) s = s.slice(0, x.start) + " ".repeat(x.end - x.start) + s.slice(x.end);
  return s;
}
const stripDates = (text: string, dates: Found<string>[]) =>
  blank(text, dates).replace(/\s+/g, " ").trim();

/** A person's name matches when every word typed starts a word of their name. */
export function nameMatches(typed: string, full: string): boolean {
  const want = norm(typed).split(" ").filter(Boolean);
  const have = norm(full).split(" ").filter(Boolean);
  return want.length > 0 && want.every((w) => have.some((h) => h.startsWith(w)));
}

export const HELP_LINES = [
  "today · tomorrow · bookings on 14 Nov",
  "who is at 4 pm tomorrow",
  "free slots tomorrow for haircut",
  "earnings this week · how many bookings today",
  "find Ravi",
  "book Ravi 9876543210 haircut tomorrow 4 pm",
  "move Ravi to 5 pm  ·  move BK-7KQ2MX to 14 Nov 11 am",
  "cancel Ravi tomorrow because unwell",
  "Ravi arrived · Ravi in chair · Ravi done · Ravi no show",
  "block 3 pm to 5 pm today for training",
  "close 25 Dec for Christmas · reopen 25 Dec",
  "which times are blocked · unblock 3 pm today",
  "Kiran off tomorrow · Meera not available Friday 2 to 4",
  "change haircut price to 600",
  "Kumar's phone number",
];
