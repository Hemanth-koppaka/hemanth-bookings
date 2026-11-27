import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { metaWithStaff, staffChoiceOf, staffIdOf, rescheduleChoice } from "./booking-staff";
import { withHistory, type HistoryEntry } from "./history";
import { bookingSnapshot } from "./booking-snapshot";

// All salon data lives in tables with no public access; every read/write goes
// through these handlers. Customer calls expose only free slots or a booking
// matched by reference + phone, and every booking change is re-validated here
// against the live schedule. Admin calls require a signed session token
// (obtained by exchanging the access code in adminSignIn); the `pin` field on
// admin inputs carries that token.

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function assertPin(token: string) {
  const { assertAdmin } = await import("./admin-auth.server");
  return assertAdmin(token);
}

const last10 = (p: string) => p.replace(/\D/g, "").slice(-10);

/** The stylist rule a booking was made with: its own stylist if chosen, else "any". */
const bookingChoice = (row: Record<string, unknown>) => rescheduleChoice(row, undefined);

export type BookingRow = {
  reference: string;
  audience: "men" | "women";
  serviceIds: string[];
  date: string;
  time: number;
  slots: number;
  customer: { name: string; phone: string; email: string; notes?: string };
  status: "confirmed" | "cancelled";
  source: "online" | "walk-in" | "phone" | "whatsapp" | "admin";
  meta: Record<string, string | number | boolean | null>;
  createdAt: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRow(r: any): BookingRow {
  return {
    reference: r.reference,
    audience: r.audience,
    serviceIds: r.service_ids ?? [],
    date: r.date,
    time: r.time,
    slots: r.slots,
    customer: r.customer,
    status: r.status,
    source: r.source,
    meta: r.meta ?? {},
    createdAt: r.created_at,
  };
}

/* ── Public ─────────────────────────────────────────────────── */

const toMin = (t: string | null | undefined) => {
  if (!t) return undefined;
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const hhmm = (t: string) => t.slice(0, 5);
type PersistedBreaks = Record<string, { start: string; end: string }[]>;

const loadConfig = async () => (await import("./config.server")).loadConfigFast();

export const getSalonConfig = createServerFn({ method: "GET" }).handler(async () => {
  // the site's own address too, for search engines (absolute links)
  return { configJson: JSON.stringify(await loadConfig()), origin: await requestOrigin() };
});

// Booking writes live in a server-only module (also exercised by tests).
const B = () => import("./bookings.server");
/** `fresh` for anything that saves a booking (latest hours, closures, prices). */
const engine = async (fresh = false) => (await B()).engine(fresh);
type Sb = Awaited<ReturnType<typeof db>>;
const insertBooking = async (...a: Parameters<Awaited<ReturnType<typeof B>>["insertBooking"]>) =>
  (await B()).insertBooking(...a);
const patchBooking = async (
  _sb: Sb,
  ...a: Parameters<Awaited<ReturnType<typeof B>>["patchBooking"]>
) => (await B()).patchBooking(...a);

const bookingInput = z.object({
  // accepted for compatibility; the server issues the real booking ID
  reference: z.string().max(20).optional(),
  audience: z.enum(["men", "women"]),
  serviceIds: z.array(z.string().max(80)).min(1).max(20),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.number().int().min(0).max(1440),
  slots: z.number().int().min(1).max(40).optional(),
  customer: z.object({
    name: z.string().trim().min(1).max(100),
    phone: z.string().trim().min(7).max(20),
    email: z.string().trim().max(255),
    notes: z.string().max(1000).optional(),
  }),
  // Optional reference photos uploaded during booking (pending/<draft>/<file>).
  photos: z
    .array(
      z.union([
        // Legacy local drafts may still contain bare paths; they are ignored unless
        // accompanied by a server-issued proof below.
        z.string().regex(/^pending\/[0-9a-f-]{36}\/[a-z0-9]+\.(jpg|png|webp)$/),
        z
          .object({
            path: z.string().regex(/^pending\/[0-9a-f-]{36}\/[a-z0-9]+\.(jpg|png|webp)$/),
            proof: z.string().max(100),
          })
          .strict(),
      ]),
    )
    .max(3)
    .optional(),
  /** Agreed to booking messages on WhatsApp/SMS. */
  consent: z.boolean().optional(),
  allowRepeat: z.boolean().optional(),
  /** A chosen stylist; omitted = any available stylist. */
  staffId: z.string().uuid().optional(),
});

/**
 * A scrambled code for the guest's internet connection (never the address
 * itself), used only to limit bookings per hour from one connection.
 */
async function connectionCode(): Promise<string> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const h = getRequest().headers;
    const ip = (
      h.get("cf-connecting-ip") ??
      h.get("x-real-ip") ??
      h.get("x-forwarded-for")?.split(",")[0] ??
      ""
    ).trim();
    if (!ip) return "";
    const d = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`bk-salon:${ip}`)),
    );
    return Array.from(d.slice(0, 8), (x) => x.toString(16).padStart(2, "0")).join("");
  } catch {
    return "";
  }
}

/** The site address the request came from (for links in messages); "" if unknown. */
async function requestOrigin(): Promise<string> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const req = getRequest();
    const h = req.headers;
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "https";
    const o = h.get("origin") || (host ? `${proto.split(",")[0]}://${host.split(",")[0]}` : "");
    return /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(o) ? o : "";
  } catch {
    return "";
  }
}

/**
 * Booking notifications run after the booking is saved and never affect it.
 * A guest's own booking, move or cancellation also pops up on the salon's
 * phones (free web push), never waiting more than a few seconds.
 */
const notify = async (...a: Parameters<typeof import("./notify/service.server").notifySoon>) => {
  const [reference, event, ctx] = a;
  // A guest's move reaches the salon's phones at once; the stylist's phone gets
  // it from the database change alert (no duplicates). Other changes go to the
  // salon and that stylist straight away.
  const guestMove = event === "BOOKING_RESCHEDULED" && ctx?.actor === "guest";
  const phone =
    guestMove || !["BOOKING_RESCHEDULED", "BOOKING_COMPLETED", "NO_SHOW"].includes(event)
      ? Promise.race([
          import("./push.server").then((P) =>
            P.pushBookingEvent(
              reference,
              event,
              guestMove ? { ownersOnly: true } : { staffOnly: ctx?.actor !== "guest" },
            ),
          ),
          new Promise((r) => setTimeout(r, 5000)),
        ]).catch(() => undefined)
      : Promise.resolve();
  // a freed time: tell guests waiting for that day (cancelled, or moved away)
  const freed =
    event === "BOOKING_CANCELLED" || event === "BOOKING_RESCHEDULED"
      ? (async () => {
          const W = await import("./waitlist.server");
          const prev = (ctx as { previous?: { date: string } } | undefined)?.previous?.date;
          if (event === "BOOKING_RESCHEDULED" && prev) return W.timeFreedOn(prev);
          const { data: r } = await (
            await db()
          )
            .from("bookings")
            .select("date")
            .eq("reference", reference)
            .maybeSingle();
          return r ? W.timeFreedOn((r as { date: string }).date) : 0;
        })().catch(() => undefined)
      : Promise.resolve();
  await Promise.all([
    (["BOOKING_RESCHEDULED", "BOOKING_COMPLETED", "NO_SHOW"].includes(event)
      ? (await import("./appointment-change.server")).dispatchAppointmentChanges(reference)
      : (await import("./notify/service.server")).notifySoon(...a)
    ).catch(() => undefined),
    phone,
    freed,
  ]);
};

export const createBooking = createServerFn({ method: "POST" })
  .inputValidator((d) => bookingInput.parse(d))
  .handler(async ({ data }) => {
    const photoPaths: string[] = [];
    if (data.photos?.length) {
      const { verifyPendingPhotoProof } = await import("./admin-auth.server");
      for (const photo of data.photos) {
        if (typeof photo === "string") continue;
        if (await verifyPendingPhotoProof(photo.path, photo.proof)) photoPaths.push(photo.path);
      }
    }
    const r = await insertBooking(
      {
        audience: data.audience,
        serviceIds: data.serviceIds,
        date: data.date,
        time: data.time,
        customer: data.customer,
        source: "online",
        notifyConsent: Boolean(data.consent),
        siteOrigin: await requestOrigin(),
        staffChoice: data.staffId ?? "any",
        allowRepeat: data.allowRepeat ?? false,
        meta: { ip: await connectionCode() },
      },
      { staff: false, ...(photoPaths.length ? { photos: photoPaths } : {}) },
    );
    const { sweepPhotos } = await import("./photos.server");
    await sweepPhotos().catch(() => {});
    if (!r.ok) return { ok: false as const, error: r.error };
    // the booking is committed; now tell the guest and the salon
    await notify(r.reference, "BOOKING_CONFIRMED", { actor: "guest" });
    // the booking's own snapshot (for the confirmation and calendar export)
    return {
      ok: true as const,
      reference: r.reference,
      snapshot: { services: r.services, minutes: r.minutes, price: r.price },
      stylist: r.staffName,
    };
  });

/** Bookable start times for a day, for the selected services (customer time picker). */
/** Same services, in any order. */
function sameServices(a: string[], b: string[]) {
  const x = [...new Set(a)].sort();
  const y = [...new Set(b)].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

export const getAvailability = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        audience: z.enum(["men", "women"]),
        serviceIds: z.array(z.string().max(80)).min(1).max(20),
        // when moving an existing booking, its own time doesn't count as taken
        reference: z.string().max(20).optional(),
        phone: z.string().max(20).optional(),
        token: z.string().max(64).optional(),
        /** a chosen stylist; omitted = any available */
        staffId: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    // the day's reads don't need the salon configuration: start them while it loads
    const prefetch = (await import("./engine.server")).prefetchDay(data.date);
    const E = await engine();
    const rules = prefetch.rules;
    let q: { minutes: number; buffer: number } = E.quote(data.audience, data.serviceIds) ?? {
      minutes: 30,
      buffer: 0,
    };
    let ignore: string | undefined;
    let serviceIds = data.serviceIds;
    let choice = data.staffId ?? "any";
    if (data.reference && (data.phone || data.token)) {
      const sb = await db();
      const { data: r } = await sb
        .from("bookings")
        .select("*")
        .eq("reference", data.reference)
        .maybeSingle();
      if (r && (await owns(r, data))) {
        ignore = r.reference;
        const row = r as Record<string, unknown>;
        const own = (r.service_ids as string[] | null) ?? [];
        if (sameServices(own, data.serviceIds)) {
          // a booking keeps the length it was made with
          q = {
            minutes: (row["duration_minutes"] as number | null) ?? r.slots * 30,
            buffer: (row["buffer_minutes"] as number | null) ?? 0,
          };
          serviceIds = own.length ? own : serviceIds;
        }
        // (changing services: the new services' length, as quoted above)
        choice = rescheduleChoice(row, data.staffId);
      }
    }
    return E.availability(data.date, q, rules, {
      ...(ignore ? { ignoreReference: ignore } : {}),
      serviceIds,
      choice,
      prefetch,
    });
  });

/** Public booking rules the customer screens need (no internal settings). */
export const getPublicRules = createServerFn({ method: "GET" }).handler(async () => {
  const E = await engine();
  const r = await E.loadRules();
  return {
    accepting: r.accepting,
    pauseMessage: r.pauseMessage,
    allowMultiple: r.allowMultiple,
    maxServices: r.maxServices,
    maxAdvanceDays: r.maxAdvanceDays,
    allowSameDay: r.allowSameDay,
    customerCancel: r.customerCancel,
    cancelDeadlineMinutes: r.cancelDeadlineMinutes,
    customerReschedule: r.customerReschedule,
    rescheduleDeadlineMinutes: r.rescheduleDeadlineMinutes,
  };
});

const lookup = z.object({
  reference: z.string().max(20),
  phone: z.string().max(20).optional(),
  /** Key from a Manage booking lookup (stands in for the phone). */
  token: z.string().max(64).optional(),
});

/** True when the caller proved ownership with the booking's phone or its manage key. */
async function owns(
  r: { reference: string; customer: unknown },
  auth: { phone?: string | undefined; token?: string | undefined },
) {
  if (auth.phone && last10((r.customer as { phone: string }).phone) === last10(auth.phone))
    return true;
  if (auth.token) {
    const { checkManageToken } = await import("./admin-auth.server");
    return checkManageToken(r.reference, auth.token);
  }
  return false;
}

/** The appointment has ended (or was cancelled): nothing left to change. */
function visitOverRow(row: Record<string, unknown>) {
  const meta = (row["meta"] ?? {}) as Record<string, unknown>;
  if (
    row["status"] === "cancelled" ||
    ["cancelled", "no-show", "completed"].includes(meta["status"] as string)
  )
    return true;
  const now = new Date(Date.now() + 330 * 60_000);
  const today = now.toISOString().slice(0, 10);
  const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
  const end =
    (row["time"] as number) +
    ((row["duration_minutes"] as number | null) ?? ((row["slots"] as number) ?? 1) * 30);
  return (row["date"] as string) < today || ((row["date"] as string) === today && end <= minute);
}

/** A finished, uncancelled visit that hasn't been rated yet (salon time, UTC+5:30). */
function rateable(row: Record<string, unknown>) {
  const meta = (row["meta"] ?? {}) as Record<string, unknown>;
  const st = meta["status"] as string | undefined;
  if (row["status"] === "cancelled" || st === "cancelled" || st === "no-show" || meta["rating"])
    return false;
  const now = new Date(Date.now() + 330 * 60_000);
  const today = now.toISOString().slice(0, 10);
  const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
  const time = row["time"] as number;
  const end =
    (row["ends_at_minute"] as number | null) ?? time + ((row["slots"] as number) ?? 1) * 30;
  const date = row["date"] as string;
  return st === "completed" || date < today || (date === today && end <= minute);
}

/**
 * A guest rates the services of their own finished visit (1–5 stars each),
 * once. Stored on the booking, then added to each service's own totals
 * (by service id: men's and women's services are rated separately).
 */
export const rateMyVisit = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    lookup
      .extend({
        ratings: z
          .array(z.object({ serviceId: z.string().max(80), stars: z.number().int().min(1).max(5) }))
          .min(1)
          .max(20),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const sb = await db();
    const { data: r } = await sb
      .from("bookings")
      .select("*")
      .eq("reference", data.reference.toUpperCase())
      .maybeSingle();
    if (!r || !(await owns(r, data)))
      return { ok: false as const, error: "We couldn't find that booking." };
    const row = r as Record<string, unknown>;
    if ((row["meta"] as Record<string, unknown> | null)?.["rating"])
      return { ok: false as const, error: "Thank you, this visit has already been rated." };
    if (!rateable(row))
      return {
        ok: false as const,
        error: "You can rate your visit once your appointment is over.",
      };
    const booked = new Set((r.service_ids as string[] | null) ?? []);
    const stars = new Map<string, number>();
    for (const x of data.ratings) if (booked.has(x.serviceId)) stars.set(x.serviceId, x.stars);
    if (!stars.size)
      return { ok: false as const, error: "Please rate the services from this visit." };
    // on the booking first, so a visit can never be counted twice
    const meta = {
      ...((row["meta"] as Record<string, unknown> | null) ?? {}),
      rating: { at: new Date().toISOString(), stars: Object.fromEntries(stars) },
    };
    const error = await patchBooking(sb, r.reference, { meta }, {});
    if (error) return { ok: false as const, error: "Couldn't save your rating. Please try again." };
    const { data: cur } = await sb
      .from("site_settings")
      .select("value")
      .eq("key", "service_ratings")
      .maybeSingle();
    const totals = {
      ...((cur?.value as Record<string, { sum: number; count: number }> | null) ?? {}),
    };
    for (const [id, n] of stars)
      totals[id] = { sum: (totals[id]?.sum ?? 0) + n, count: (totals[id]?.count ?? 0) + 1 };
    await sb.from("site_settings").upsert({ key: "service_ratings", value: totals as never });
    const E = await engine();
    await E.audit({
      actor: "guest",
      action: "booking.rated",
      entity: "booking",
      entityId: r.reference,
      summary: `Guest rated ${r.reference}: ${[...stars.values()].join(", ")} ★`,
      after: Object.fromEntries(stars),
    });
    return { ok: true as const };
  });

const maskPhone = (p: string) => {
  const d = p.replace(/\D/g, "").slice(-10);
  return d.length >= 4 ? `•••••• ${d.slice(-4)}` : "••••";
};

/** Manage booking requires the exact reference and the booking phone together. */
export const findMyBookings = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        reference: z
          .string()
          .trim()
          .regex(/^BK-[A-Z0-9]{6}$/i),
        phone: z
          .string()
          .trim()
          .min(10)
          .max(20)
          .regex(/^[+\d\s().-]+$/),
      })
      .strict()
      .parse(d),
  )
  .handler(async ({ data }) => {
    const sb = await db();
    const { manageToken } = await import("./admin-auth.server");
    const reference = data.reference.toUpperCase();
    const { data: row } = await sb
      .from("bookings")
      .select("*")
      .eq("reference", reference)
      .maybeSingle();
    const phoneKey = last10(data.phone);
    const rows: Record<string, unknown>[] =
      row &&
      phoneKey.length === 10 &&
      last10((row.customer as { phone?: string })?.phone ?? "") === phoneKey
        ? [row as Record<string, unknown>]
        : [];
    const bookings = await Promise.all(
      rows.map(async (r) => {
        const b = toRow(r);
        const row = r as Record<string, unknown>;
        const snap =
          (row["services_snapshot"] as
            { id?: string; name: string; price: number; minutes?: number }[] | null) ?? [];
        return {
          ...b,
          staffId: staffIdOf(row),
          stylist:
            ((row["meta"] as Record<string, unknown> | null)?.["staff_name"] as string | null) ??
            null,
          stylistChosen: staffChoiceOf(row) === "specific",
          rateable: rateable(row),
          snapshot: snap.length
            ? {
                services: snap.map((x) => ({
                  ...(x.id ? { id: x.id } : {}),
                  name: x.name,
                  price: x.price,
                  minutes: x.minutes ?? 30,
                })),
                minutes:
                  (row["duration_minutes"] as number | null) ??
                  snap.reduce((n, x) => n + (x.minutes ?? 30), 0),
                price:
                  (row["price_total"] as number | null) ?? snap.reduce((n, x) => n + x.price, 0),
              }
            : null,
          meta: {},
          customer: { ...b.customer, phone: maskPhone(b.customer.phone), email: "" },
          token: await manageToken(b.reference),
        };
      }),
    );
    return { bookings };
  });

export const findMyBooking = createServerFn({ method: "POST" })
  .inputValidator((d) => lookup.parse(d))
  .handler(async ({ data }) => {
    const sb = await db();
    const { data: r } = await sb
      .from("bookings")
      .select("*")
      .eq("reference", data.reference.trim().toUpperCase())
      .maybeSingle();
    if (!r || !(await owns(r, data))) {
      return { booking: null };
    }
    // Staff notes, payment and chair assignments stay internal.
    const changes = await (
      await import("./appointment-change.server")
    ).customerAppointmentChanges(r.reference);
    const row = r as Record<string, unknown>;
    const staffId = staffIdOf(row);
    const { data: stylist } = staffId
      ? await sb.from("staff").select("name").eq("id", staffId).maybeSingle()
      : { data: null };
    return {
      booking: {
        ...toRow(r),
        staffId,
        stylist: stylist?.name ?? null,
        stylistChosen: staffChoiceOf(row) === "specific",
        meta: {},
        changes,
        snapshot: bookingSnapshot(row),
        rateable: rateable(row),
      },
    };
  });

export const updateMyBooking = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    lookup
      .extend({
        action: z.enum(["cancel", "reschedule"]),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        time: z.number().int().min(0).max(1440).optional(),
        staffId: z.string().uuid().nullable().optional(),
        /** new services (same audience); omitted = keep the booked ones */
        serviceIds: z.array(z.string().max(80)).min(1).max(20).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const sb = await db();
    const { data: r } = await sb
      .from("bookings")
      .select("*")
      .eq("reference", data.reference.trim().toUpperCase())
      .maybeSingle();
    if (!r || !(await owns(r, data))) {
      return { ok: false, error: "Booking not found." };
    }
    const row = r as Record<string, unknown>;
    const status = (r.meta as { status?: string })?.status;
    if (r.status === "cancelled" || status === "cancelled")
      return { ok: false, error: "This booking was cancelled." };
    if (status === "completed" || status === "no-show")
      return { ok: false, error: "This appointment has already taken place." };

    const E = await engine(true);
    const rules = await E.loadRules();
    const now = E.salonNow();
    const minutesUntil = E.dayDiff(now.iso, r.date) * 1440 + r.time - now.minute;

    if (data.action === "cancel") {
      if (!rules.customerCancel)
        return { ok: false, error: "Online cancellation is off. Please call the studio." };
      if (minutesUntil < rules.cancelDeadlineMinutes) {
        return {
          ok: false,
          error: "It's too close to your appointment to cancel online. Please call the studio.",
        };
      }
      const error = await patchBooking(
        sb,
        r.reference,
        { status: "cancelled" },
        {
          cancelled_at: new Date().toISOString(),
          cancel_reason: "Cancelled by guest online",
          history: withHistory(row, { by: "guest", action: "cancelled" }),
        },
      );
      if (error) return { ok: false, error: "Couldn't cancel this booking. Please try again." };
      // a cancelled booking's reference photos are deleted straight away
      const { deleteBookingPhotos } = await import("./photos.server");
      await deleteBookingPhotos(r.reference).catch(() => {});
      const cust = r.customer as Record<string, unknown> | null;
      if (cust?.["photos"]) {
        const { photos: _gone, ...rest } = cust;
        await sb
          .from("bookings")
          .update({ customer: rest as never })
          .eq("reference", r.reference);
      }
      await E.audit({
        actor: "guest",
        action: "booking.cancel",
        entity: "booking",
        entityId: r.reference,
        summary: `Guest cancelled ${r.reference}`,
      });
      await notify(r.reference, "BOOKING_CANCELLED", { actor: "guest" });
      return { ok: true };
    }

    if (!data.date || data.time == null) return { ok: false, error: "Pick a new date and time." };
    if (!rules.customerReschedule)
      return { ok: false, error: "Online rescheduling is off. Please call the studio." };
    if (minutesUntil < rules.rescheduleDeadlineMinutes) {
      return {
        ok: false,
        error: "It's too close to your appointment to move it online. Please call the studio.",
      };
    }
    const ownIds = (r.service_ids as string[] | null) ?? [];
    const newIds =
      data.serviceIds && !sameServices(ownIds, data.serviceIds)
        ? [...new Set(data.serviceIds)]
        : null;
    const moved = data.date !== r.date || data.time !== r.time;
    if (newIds) {
      if (!rules.allowMultiple && newIds.length > 1)
        return { ok: false, error: "Please choose one service per booking." };
      if (newIds.length > rules.maxServices)
        return {
          ok: false,
          error: `Please choose up to ${rules.maxServices} services per booking.`,
        };
    }
    const quoted = newIds ? E.quote(r.audience as "men" | "women", newIds) : null;
    if (newIds && !quoted)
      return {
        ok: false,
        error: "One of those services is no longer offered. Please choose again.",
      };
    // changing only the services doesn't count as moving the appointment
    const moves = ((row["history"] as HistoryEntry[] | undefined) ?? []).filter(
      (h) => h.by === "guest" && h.action === "rescheduled",
    ).length;
    if (moved && moves >= rules.maxReschedules)
      return {
        ok: false,
        error: "This booking can't be moved online again. Please call the studio.",
      };
    // the appointment keeps the length it was booked with (new services: their length)
    const held = quoted
      ? { minutes: quoted.minutes, buffer: quoted.buffer }
      : {
          minutes: (row["duration_minutes"] as number | null) ?? r.slots * 30,
          buffer: (row["buffer_minutes"] as number | null) ?? 0,
        };
    const check = await E.checkTime(data.date, data.time, held, rules, {
      ignoreReference: r.reference,
      serviceIds: newIds ?? ownIds,
      choice: rescheduleChoice(row, data.staffId),
    });
    if (!check.ok) return check;
    const choice = rescheduleChoice(row, data.staffId) === "any" ? "any" : "specific";
    const { data: stylist } = check.staffId
      ? await sb.from("staff").select("name").eq("id", check.staffId).maybeSingle()
      : { data: null };
    const error = await patchBooking(
      sb,
      r.reference,
      {
        date: data.date,
        time: data.time,
        ...(check.staffId !== undefined
          ? {
              meta: {
                ...metaWithStaff(row["meta"], check.staffId, choice),
                staff_name: stylist?.name ?? null,
              },
            }
          : {}),
      },
      {
        ...(check.staffId !== undefined ? { staff_id: check.staffId, staff_choice: choice } : {}),
        ...(newIds && quoted
          ? {
              service_ids: newIds,
              services_snapshot: quoted.snapshot,
              slots: Math.max(1, Math.ceil(quoted.minutes / 30)),
              duration_minutes: quoted.minutes,
              buffer_minutes: quoted.buffer,
              price_total: quoted.price,
            }
          : {}),
        history: withHistory(row, {
          by: "guest",
          action: moved ? "rescheduled" : "services changed",
          from: {
            date: r.date,
            time: r.time,
            staffId: staffIdOf(row),
            ...(newIds ? { services: ownIds } : {}),
          },
          to: {
            date: data.date,
            time: data.time,
            staffId: check.staffId,
            ...(newIds ? { services: newIds } : {}),
          },
        }),
      },
    );
    if (error) {
      return {
        ok: false,
        error: E.isSlotTaken(error)
          ? "That time was just booked. Please choose another time."
          : "Couldn't move this booking. Please try again.",
      };
    }
    await E.audit({
      actor: "guest",
      action: newIds && !moved ? "booking.services" : "booking.reschedule",
      entity: "booking",
      entityId: r.reference,
      summary:
        newIds && !moved
          ? `Guest changed the services of ${r.reference}`
          : `Guest moved ${r.reference}${newIds ? " and changed its services" : ""}`,
      before: { date: r.date, time: r.time, ...(newIds ? { services: ownIds } : {}) },
      after: { date: data.date, time: data.time, ...(newIds ? { services: newIds } : {}) },
    });
    await notify(r.reference, moved ? "BOOKING_RESCHEDULED" : "BOOKING_UPDATED", {
      actor: "guest",
      previous: { date: r.date, time: r.time },
    });
    return {
      ok: true,
      staffId: check.staffId,
      stylist: stylist?.name ?? null,
      stylistChosen: choice === "specific",
    };
  });

/* ── Admin (access code) ────────────────────────────────────── */

// `pin` carries the admin session token.
const pinOnly = z.object({ pin: z.string().max(512) });
const hhmmTime = z.string().regex(/^\d{2}:\d{2}$/);

/** Exchanges the access code for a session token (throttled after repeated misses). */
export const adminSignIn = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ code: z.string().trim().min(1).max(32) }).parse(d))
  .handler(async ({ data }) => {
    const { signIn } = await import("./admin-auth.server");
    return signIn(data.code);
  });

export const adminListBookings = createServerFn({ method: "POST" })
  .inputValidator((d) => pinOnly.parse(d))
  .handler(async ({ data }) => {
    const sb = await assertPin(data.pin);
    const { sweepPhotos } = await import("./photos.server");
    await sweepPhotos().catch(() => {});
    const [{ data: rows }, { data: cfg }, { data: booking }] = await Promise.all([
      sb.from("bookings").select("*").order("date", { ascending: false }).limit(2000),
      sb.from("salon_config").select("data").eq("id", 1).maybeSingle(),
      sb.from("site_settings").select("value").eq("key", "booking").maybeSingle(),
    ]);
    const shared = (cfg?.data ?? {}) as { staff?: unknown };
    return {
      bookings: (rows ?? []).map(toRow),
      staffJson: Array.isArray(shared.staff) ? JSON.stringify(shared.staff) : null,
      accepting: ((booking?.value ?? {}) as { accepting?: boolean }).accepting ?? true,
    };
  });

export const adminUpsertBooking = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    pinOnly
      .extend({
        reference: z.string().max(20),
        insert: bookingInput
          .omit({ reference: true })
          .extend({ source: z.enum(["online", "walk-in", "phone", "whatsapp", "admin"]) })
          .optional(),
        patch: z
          .object({
            date: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .optional(),
            time: z.number().int().min(0).max(1440).optional(),
            status: z.enum(["confirmed", "cancelled"]).optional(),
            meta: z.record(z.string(), z.unknown()).optional(),
            cancelReason: z.string().max(200).optional(),
            customer: z
              .object({
                name: z.string().trim().min(1).max(100),
                phone: z.string().trim().max(20),
                email: z.string().trim().max(255),
              })
              .optional(),
            /** reassign to a stylist ("any" = whoever is free) */
            staffId: z.union([z.string().uuid(), z.literal("any")]).optional(),
          })
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const sb = await assertPin(data.pin);
    const E = await engine(true);
    if (data.insert) {
      const i = data.insert;
      const r = await insertBooking(
        {
          audience: i.audience,
          serviceIds: i.serviceIds,
          date: i.date,
          time: i.time,
          customer: i.customer,
          source: i.source,
          staffChoice: i.staffId ?? "any",
        },
        { staff: true },
      );
      if (!r.ok) throw new Error(r.error);
      // (stylist chosen or assigned by the engine)
      await E.audit({
        action: "booking.create",
        entity: "booking",
        entityId: r.reference,
        summary: `Added ${i.source} booking ${r.reference} for ${i.customer.name}`,
        after: { date: i.date, time: i.time, services: i.serviceIds },
      });
      // phone/WhatsApp bookings get a confirmation; walk-ins are already in the chair
      if (i.source !== "walk-in")
        await notify(r.reference, "BOOKING_CONFIRMED", { actor: "admin" });
      return { ok: true, reference: r.reference };
    }
    if (!data.patch) return { ok: true, reference: data.reference };

    const { data: current } = await sb
      .from("bookings")
      .select("*")
      .eq("reference", data.reference)
      .maybeSingle();
    if (!current) throw new Error("Booking not found");
    const row = current as Record<string, unknown>;
    const p = data.patch;
    const base: Record<string, unknown> = {};
    const extra: Record<string, unknown> = {};
    const moved =
      (p.date && p.date !== current.date) || (p.time != null && p.time !== current.time);
    const restaff =
      p.staffId !== undefined &&
      (p.staffId === "any" ? staffChoiceOf(row) !== "any" : p.staffId !== staffIdOf(row));

    if (moved || restaff) {
      // admins can't create clashes either; the booking keeps its booked length
      const held = {
        minutes: (row["duration_minutes"] as number | null) ?? current.slots * 30,
        buffer: (row["buffer_minutes"] as number | null) ?? 0,
      };
      const choice = p.staffId ?? bookingChoice(row);
      const check = await E.checkTime(
        p.date ?? current.date,
        p.time ?? current.time,
        held,
        await E.loadRules(),
        {
          staff: true,
          ignoreReference: current.reference,
          serviceIds: (current.service_ids as string[] | null) ?? [],
          choice,
        },
      );
      if (!check.ok) throw new Error(check.error.replace("just booked", "already booked"));
      if (check.staffId !== undefined) {
        extra["staff_id"] = check.staffId;
        extra["staff_choice"] = choice === "any" ? "any" : "specific";
        // kept in meta as well, which works on every database version
        base["meta"] = metaWithStaff(
          base["meta"] ?? current.meta,
          check.staffId,
          choice === "any" ? "any" : "specific",
        );
        // and the stylist's name, so summaries and alerts name the new stylist
        if (check.staffId) {
          const { stable } = await import("./staff-store.server");
          const { data: st } = await stable("staff")
            .select("name")
            .eq("id", check.staffId)
            .maybeSingle();
          const name = (st as { name?: string } | null)?.name;
          if (name)
            base["meta"] = { ...(base["meta"] as Record<string, unknown>), staff_name: name };
        }
      }
      if (moved) {
        base["date"] = p.date ?? current.date;
        base["time"] = p.time ?? current.time;
        extra["history"] = withHistory(row, {
          by: "admin",
          action: "rescheduled",
          from: { date: current.date, time: current.time },
          to: { date: base["date"], time: base["time"] },
        });
      } else {
        extra["history"] = withHistory(row, { by: "admin", action: "stylist changed" });
      }
    }
    const metaStatus = (p.meta as { status?: string } | undefined)?.status;
    const prevStatus = (current.meta as { status?: string } | null)?.status;
    const cancelling = p.status === "cancelled" || metaStatus === "cancelled";
    if (p.status) base["status"] = p.status;
    // merge, so a status change never wipes notes or payment details
    if (p.meta)
      base["meta"] = {
        ...(((base["meta"] ?? current.meta) as Record<string, unknown> | null) ?? {}),
        ...p.meta,
      };
    if (p.customer)
      base["customer"] = {
        ...((current.customer as Record<string, unknown>) ?? {}),
        ...p.customer,
      };
    if (cancelling && current.status !== "cancelled") {
      base["status"] = "cancelled";
      extra["cancelled_at"] = new Date().toISOString();
      extra["cancel_reason"] = p.cancelReason ?? "";
      extra["history"] = withHistory(
        { history: extra["history"] ?? row["history"] },
        { by: "admin", action: "cancelled", ...(p.cancelReason ? { reason: p.cancelReason } : {}) },
      );
    } else if (metaStatus && metaStatus !== prevStatus) {
      extra["history"] = withHistory(
        { history: extra["history"] ?? row["history"] },
        { by: "admin", action: `status:${metaStatus}` },
      );
      if (current.status === "cancelled" && metaStatus !== "cancelled")
        base["status"] = "confirmed"; // restored
    }

    const error = await patchBooking(sb, data.reference, base, extra);
    if (error) {
      throw new Error(
        E.isSlotTaken(error)
          ? "That time is no longer available."
          : "Couldn't update the appointment",
      );
    }
    if (p.customer) {
      await E.audit({
        action: "booking.edit",
        entity: "booking",
        entityId: data.reference,
        summary: `Edited contact details on ${data.reference}`,
        before: current.customer,
        after: base["customer"],
      });
    }
    if (moved) {
      await E.audit({
        action: "booking.reschedule",
        entity: "booking",
        entityId: data.reference,
        summary: `Moved ${data.reference}`,
        before: { date: current.date, time: current.time },
        after: { date: base["date"], time: base["time"] },
      });
    }
    if (cancelling && current.status !== "cancelled") {
      await E.audit({
        action: "booking.cancel",
        entity: "booking",
        entityId: data.reference,
        summary: `Cancelled ${data.reference}`,
        reason: p.cancelReason ?? "",
      });
    } else if (metaStatus && metaStatus !== prevStatus) {
      await E.audit({
        action: "booking.status",
        entity: "booking",
        entityId: data.reference,
        summary: `${data.reference}: ${prevStatus ?? "upcoming"} → ${metaStatus}`,
        before: { status: prevStatus ?? "upcoming" },
        after: { status: metaStatus },
      });
    }

    // messages: guest is told about moves and cancellations; reminders follow the booking
    if (cancelling && current.status !== "cancelled")
      await notify(data.reference, "BOOKING_CANCELLED", { actor: "admin" });
    else if (moved)
      await notify(data.reference, "BOOKING_RESCHEDULED", {
        actor: "admin",
        previous: { date: current.date, time: current.time },
      });
    else if (metaStatus === "upcoming" && prevStatus === "pending")
      await notify(data.reference, "BOOKING_CONFIRMED", { actor: "admin" });
    else if (metaStatus === "completed" && prevStatus !== "completed")
      await notify(data.reference, "BOOKING_COMPLETED", { actor: "admin" });
    else if (metaStatus === "no-show" && prevStatus !== "no-show")
      await notify(data.reference, "NO_SHOW", { actor: "admin" });
    else if (restaff || p.customer || (metaStatus && metaStatus !== prevStatus))
      await (
        await import("./appointment-change.server")
      ).dispatchAppointmentChanges(data.reference);

    // Reference photos are only kept until the visit is over.
    if (cancelling || metaStatus === "completed" || metaStatus === "no-show") {
      const { deleteBookingPhotos } = await import("./photos.server");
      await deleteBookingPhotos(data.reference).catch(() => {});
      const c = current.customer as Record<string, unknown> | undefined;
      if (c?.["photos"]) {
        const { photos: _gone, ...rest } = c;
        await sb
          .from("bookings")
          .update({ customer: rest as never })
          .eq("reference", data.reference);
      }
    }
    return { ok: true, reference: data.reference };
  });

export const adminSaveConfig = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    pinOnly
      .extend({
        config: z
          .object({
            accepting: z.boolean().optional(),
            staff: z
              .array(
                z
                  .object({
                    id: z.string().trim().min(1).max(80),
                    name: z.string().trim().min(1).max(80),
                    role: z.string().trim().min(1).max(80),
                    active: z.boolean(),
                  })
                  .strict(),
              )
              .max(30)
              .optional(),
          })
          .strict()
          .refine((config) => config.accepting !== undefined || config.staff !== undefined),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const sb = await assertPin(data.pin);
    // Merge, so saving one setting never wipes the others.
    const { data: existing } = await sb
      .from("salon_config")
      .select("data")
      .eq("id", 1)
      .maybeSingle();
    const merged = { ...((existing?.data as Record<string, unknown>) ?? {}), ...data.config };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await sb
      .from("salon_config")
      .update({ data: merged as any })
      .eq("id", 1);
    if (error) throw new Error("Couldn't save settings");
    const c = data.config;
    const E = await import("./engine.server");
    if (c.accepting !== undefined) {
      await E.audit({
        action: c.accepting ? "bookings.resume" : "bookings.pause",
        entity: "settings",
        entityId: "booking",
        summary: c.accepting ? "Resumed online bookings" : "Paused online bookings",
      });
    }
    if (c.accepting !== undefined) {
      const { data: cur } = await sb
        .from("site_settings")
        .select("value")
        .eq("key", "booking")
        .maybeSingle();
      const value = { ...((cur?.value as object) ?? {}), accepting: c.accepting };
      await sb.from("site_settings").upsert({ key: "booking", value });
      (await import("./settings-cache.server")).forgetSetting("booking_rules");
    }
    return { ok: true };
  });

const businessHourInput = z.object({
  day: z.number().int().min(0).max(6),
  open: z.boolean(),
  from: hhmmTime,
  to: hhmmTime,
  breaks: z.array(z.object({ start: hhmmTime, end: hhmmTime })).max(6),
});

export const adminSaveBusinessHours = createServerFn({ method: "POST" })
  .inputValidator((d) => pinOnly.extend({ hours: z.array(businessHourInput).length(7) }).parse(d))
  .handler(async ({ data }) => {
    const sb = await assertPin(data.pin);
    const sorted = [...data.hours].sort((a, b) => a.day - b.day);
    const seen = new Set<number>();
    const breaksByDay: PersistedBreaks = {};

    for (const h of sorted) {
      if (seen.has(h.day)) throw new Error("Duplicate day in schedule");
      seen.add(h.day);
      const open = toMin(h.from) ?? 0;
      const close = toMin(h.to) ?? 0;
      if (h.open && close <= open) throw new Error("Closing time must be after opening time");

      const normalizedBreaks = (h.open ? h.breaks : [])
        .map((b) => ({ start: toMin(b.start) ?? 0, end: toMin(b.end) ?? 0 }))
        .sort((a, b) => a.start - b.start);

      for (let i = 0; i < normalizedBreaks.length; i++) {
        const b = normalizedBreaks[i]!;
        if (b.end <= b.start) throw new Error("Break end must be after break start");
        if (b.start < open || b.end > close) {
          throw new Error("Breaks must be inside opening hours");
        }
        if (i > 0 && b.start < normalizedBreaks[i - 1]!.end) {
          throw new Error("Break periods cannot overlap");
        }
      }

      breaksByDay[String(h.day)] = normalizedBreaks.map((b) => ({
        start: hhmm(
          `${String(Math.floor(b.start / 60)).padStart(2, "0")}:${String(b.start % 60).padStart(2, "0")}`,
        ),
        end: hhmm(
          `${String(Math.floor(b.end / 60)).padStart(2, "0")}:${String(b.end % 60).padStart(2, "0")}`,
        ),
      }));
    }
    if (seen.size !== 7) throw new Error("All 7 days are required");

    const { error: hoursError } = await sb.from("opening_hours").upsert(
      sorted.map((h) => ({
        day_of_week: h.day,
        is_open: h.open,
        opening_time: h.from,
        closing_time: h.to,
      })),
    );
    if (hoursError) throw new Error("Couldn't save opening hours");

    const { data: cur } = await sb
      .from("site_settings")
      .select("value")
      .eq("key", "business_hours")
      .maybeSingle();
    const previousBreaks = (
      cur?.value as { breaksByDay?: Record<string, { start: string; end: string }[]> } | null
    )?.breaksByDay ?? { all: [{ start: "13:00", end: "14:00" }] };
    const value = { ...((cur?.value as Record<string, unknown>) ?? {}), breaksByDay };
    const { error: settingError } = await sb
      .from("site_settings")
      .upsert({ key: "business_hours", value });
    if (settingError) throw new Error("Couldn't save break periods");
    const { syncWorkingHours } = await import("./business-hours.server");
    await syncWorkingHours(sorted);
    const { retireMirroredStaffBreaks } = await import("./business-hours.server");
    await retireMirroredStaffBreaks(previousBreaks);
    const E = await import("./engine.server");
    await E.audit({
      action: "hours.update",
      entity: "hours",
      summary: "Updated opening hours and breaks",
      after: { hours: sorted, breaksByDay },
    });

    return { ok: true };
  });

/** Changes the access code; needs the current code again. Returns a fresh session. */
export const adminChangePin = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    pinOnly.extend({ current: z.string().max(32), next: z.string().regex(/^\d{6,12}$/) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { changeCode } = await import("./admin-auth.server");
    const r = await changeCode(data.pin, data.current, data.next);
    if (r.ok) {
      const E = await import("./engine.server");
      await E.audit({
        action: "security.code_change",
        entity: "security",
        summary: "Changed the admin access code",
      });
    }
    return r;
  });

/**
 * How often each service has been booked recently (last 120 days, cancellations
 * excluded). Drives the "Popular" order on the services step, so it follows what
 * guests actually book instead of a fixed list. Only counts are returned.
 */
export const getServicePopularity = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin: sb } = await import("@/integrations/supabase/client.server");
  const since = new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await sb
    .from("bookings")
    .select("service_ids, status")
    .gte("date", since)
    .neq("status", "cancelled")
    .limit(5000);
  const counts: Record<string, number> = {};
  if (error) return { counts };
  for (const r of data ?? [])
    for (const id of (r.service_ids as string[] | null) ?? []) counts[id] = (counts[id] ?? 0) + 1;
  return { counts };
});

/**
 * "Your look": the reference photos a guest attached to their own booking, as
 * short-lived private links, only until their appointment slot has ended.
 */
export const myLookPhotos = createServerFn({ method: "POST" })
  .inputValidator((d) => lookup.parse(d))
  .handler(async ({ data }) => {
    const sb = await db();
    const { data: r } = await sb
      .from("bookings")
      .select("*")
      .eq("reference", data.reference.toUpperCase())
      .maybeSingle();
    if (!r || !(await owns(r, data))) return { urls: [] as string[], over: true };
    const row = r as Record<string, unknown>;
    const st =
      ((row["meta"] as Record<string, unknown> | null)?.["status"] as string | undefined) ?? "";
    const minutes =
      (row["duration_minutes"] as number | null) ?? ((row["slots"] as number | null) ?? 1) * 30;
    // salon time (UTC+5:30), minutes from the start of the day
    const now = new Date(Date.now() + 330 * 60_000);
    const today = now.toISOString().slice(0, 10);
    const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
    const date = row["date"] as string;
    const end = (row["time"] as number) + minutes;
    const over =
      row["status"] === "cancelled" ||
      ["cancelled", "no-show", "completed"].includes(st) ||
      date < today ||
      (date === today && nowMin >= end);
    if (over) return { urls: [] as string[], over: true };
    const when = { date, time: row["time"] as number, minutes };
    const { REF_BUCKET, ensureBucket } = await import("./photos.server");
    await ensureBucket(REF_BUCKET, false);
    const bucket = sb.storage.from(REF_BUCKET);
    const folder = `bookings/${r.reference}`;
    const { data: files } = await bucket.list(folder, { limit: 10 });
    const names = (files ?? []).filter((f) => f.id).map((f) => f.name);
    const paths = names.map((n) => `${folder}/${n}`);
    // photos can be added or removed until the appointment starts
    const editable = date > today || (date === today && nowMin < (row["time"] as number));
    if (!paths.length) return { urls: [] as string[], names, over: false, editable, ...when };
    // links last until the slot ends (at least 10 minutes, at most 6 hours)
    const left = date === today ? (end - nowMin) * 60 : 6 * 3600;
    const { data: signed } = await bucket.createSignedUrls(
      paths,
      Math.max(600, Math.min(left, 6 * 3600)),
    );
    const pairs = (signed ?? [])
      .map((s, i) => ({ url: s.signedUrl, name: names[i]! }))
      .filter((x): x is { url: string; name: string } => Boolean(x.url));
    return {
      urls: pairs.map((x) => x.url),
      names: pairs.map((x) => x.name),
      over: false,
      editable,
      ...when,
    };
  });

/**
 * A booking the guest may still change photos on: theirs (phone or manage key),
 * not cancelled or finished, and the appointment hasn't started yet.
 */
async function photoBooking(data: {
  reference: string;
  phone?: string | undefined;
  token?: string | undefined;
}) {
  const sb = await db();
  const { data: r } = await sb
    .from("bookings")
    .select("*")
    .eq("reference", data.reference.toUpperCase())
    .maybeSingle();
  if (!r || !(await owns(r, data))) return { error: "Booking not found." } as const;
  const row = r as Record<string, unknown>;
  const st = ((row["meta"] as Record<string, unknown> | null)?.["status"] as string) ?? "";
  const now = new Date(Date.now() + 330 * 60_000);
  const today = now.toISOString().slice(0, 10);
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const date = row["date"] as string;
  if (row["status"] === "cancelled" || ["cancelled", "no-show", "completed"].includes(st))
    return { error: "This booking can't take photos any more." } as const;
  if (date < today || (date === today && nowMin >= (row["time"] as number)))
    return { error: "Your appointment has started, so photos can't be changed now." } as const;
  return { sb, row, reference: r.reference as string } as const;
}

/** Keeps the booking's list of photo paths in step with storage (the salon's views count it). */
async function syncPhotoList(
  sb: Awaited<ReturnType<typeof db>>,
  row: Record<string, unknown>,
  reference: string,
) {
  const { REF_BUCKET } = await import("./photos.server");
  const folder = `bookings/${reference}`;
  const { data: files } = await sb.storage.from(REF_BUCKET).list(folder, { limit: 10 });
  const photos = (files ?? []).filter((f) => f.id).map((f) => `${folder}/${f.name}`);
  const { photos: _old, ...rest } = (row["customer"] ?? {}) as Record<string, unknown>;
  await sb
    .from("bookings")
    .update({ customer: { ...rest, ...(photos.length ? { photos } : {}) } as never })
    .eq("reference", reference);
  return photos;
}

/** Manage booking: add a reference photo to an existing booking (up to 3, before it starts). */
export const addBookingPhoto = createServerFn({ method: "POST" })
  .inputValidator((d) => lookup.extend({ dataUrl: z.string().max(3_500_000) }).parse(d))
  .handler(async ({ data }) => {
    const b = await photoBooking(data);
    if ("error" in b) return { ok: false as const, error: b.error };
    const { REF_BUCKET, MAX_REFERENCE_PHOTOS, ensureBucket, decodeImage, randomName } =
      await import("./photos.server");
    let img;
    try {
      img = decodeImage(data.dataUrl);
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : "That file isn't a valid image.",
      };
    }
    await ensureBucket(REF_BUCKET, false);
    const bucket = b.sb.storage.from(REF_BUCKET);
    const folder = `bookings/${b.reference}`;
    const { data: existing } = await bucket.list(folder, { limit: 10 });
    if ((existing ?? []).filter((f) => f.id).length >= MAX_REFERENCE_PHOTOS)
      return { ok: false as const, error: `You can add up to ${MAX_REFERENCE_PHOTOS} photos.` };
    const { error } = await bucket.upload(`${folder}/${randomName()}.${img.ext}`, img.bytes, {
      contentType: img.mime,
      upsert: false,
    });
    if (error)
      return { ok: false as const, error: "Couldn't upload that photo. Please try again." };
    return { ok: true as const, photos: await syncPhotoList(b.sb, b.row, b.reference) };
  });

/** Manage booking: remove one of the booking's reference photos (before it starts). */
export const removeBookingPhoto = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    lookup.extend({ name: z.string().regex(/^[a-z0-9]{6,40}\.(jpg|png|webp)$/) }).parse(d),
  )
  .handler(async ({ data }) => {
    const b = await photoBooking(data);
    if ("error" in b) return { ok: false as const, error: b.error };
    const { REF_BUCKET } = await import("./photos.server");
    const { error } = await b.sb.storage
      .from(REF_BUCKET)
      .remove([`bookings/${b.reference}/${data.name}`]);
    if (error) return { ok: false as const, error: "Couldn't remove that photo." };
    return { ok: true as const, photos: await syncPhotoList(b.sb, b.row, b.reference) };
  });

/** The site's public key for phone notifications (safe to share). */
export const pushPublicKey = createServerFn({ method: "GET" }).handler(async () => {
  const { getVapid } = await import("./push.server");
  return { publicKey: (await getVapid()).publicKey };
});

/** A guest asks for free reminders on this phone for their own booking. */
export const remindMeOnPhone = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    lookup
      .extend({
        endpoint: z.string().url().max(1000),
        p256dh: z.string().min(40).max(200),
        auth: z.string().min(10).max(60),
        origin: z.string().max(200),
        off: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const sb = await db();
    const { data: r } = await sb
      .from("bookings")
      .select("*")
      .eq("reference", data.reference.toUpperCase())
      .maybeSingle();
    if (!r || !(await owns(r, data)))
      return { ok: false as const, error: "We couldn't find that booking." };
    if (r.status !== "confirmed" && !data.off)
      return {
        ok: false as const,
        error: "Alerts can only be enabled after booking confirmation.",
      };
    if (!/^https:\/\//.test(data.endpoint))
      return { ok: false as const, error: "This browser can't receive reminders." };
    const meta = ((r as Record<string, unknown>)["meta"] ?? {}) as Record<string, unknown>;
    const subs = ((meta["push"] as { endpoint: string }[] | undefined) ?? []).filter(
      (x) => x.endpoint !== data.endpoint,
    );
    const next = data.off
      ? subs
      : [
          ...subs,
          {
            endpoint: data.endpoint,
            keys: { p256dh: data.p256dh, auth: data.auth },
            origin: data.origin,
          },
        ].slice(-3);
    const { error } = await sb
      .from("bookings")
      .update({ meta: { ...meta, push: next } as never })
      .eq("reference", r.reference);
    if (error) return { ok: false as const, error: "Couldn't save that. Please try again." };
    return { ok: true as const, on: !data.off };
  });

/** One step of the booking journey reached (counted once per visitor per day; no cookies). */
export const trackStep = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({ step: z.enum(["home", "book", "services", "time", "details", "review", "booked"]) })
      .parse(d),
  )
  .handler(async ({ data }) => {
    try {
      const { getRequest } = await import("@tanstack/react-start/server");
      const h = getRequest().headers;
      const ip = (
        h.get("cf-connecting-ip") ??
        h.get("x-real-ip") ??
        h.get("x-forwarded-for")?.split(",")[0] ??
        ""
      ).trim();
      const { recordVisit } = await import("./visits.server");
      await recordVisit(data.step, ip, h.get("user-agent") ?? "");
    } catch {
      /* counting never affects the site */
    }
    return { ok: true };
  });

/** A guest asks to be told if a time that fits opens up on a full day (free phone notification). */
export const cancelWaitlist = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        audience: z.enum(["men", "women"]),
        serviceIds: z.array(z.string().max(80)).min(1).max(20),
        staffId: z.string().uuid().optional(),
        endpoint: z.string().url().max(1000),
        p256dh: z.string().min(40).max(200),
        auth: z.string().min(10).max(60),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const W = await import("./waitlist.server");
    return W.cancelWaitlist(data);
  });

export const joinWaitlist = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        audience: z.enum(["men", "women"]),
        serviceIds: z.array(z.string().max(80)).min(1).max(20),
        staffId: z.string().uuid().optional(),
        endpoint: z.string().url().max(1000),
        p256dh: z.string().min(40).max(200),
        auth: z.string().min(10).max(60),
        origin: z.string().max(200),
        /** "Remind me when <stylist> is back": the reminder comes the evening before */
        back: z.string().trim().min(1).max(40).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    if (!/^https:\/\//.test(data.endpoint)) return { ok: false as const };
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    if (data.date < today) return { ok: false as const };
    const W = await import("./waitlist.server");
    const entry = {
      endpoint: data.endpoint,
      keys: { p256dh: data.p256dh, auth: data.auth },
      origin: data.origin,
      audience: data.audience,
      serviceIds: data.serviceIds,
      ...(data.staffId ? { staffId: data.staffId } : {}),
      at: Date.now(),
      // remind at 6 PM (salon time) the evening before they're back
      ...(data.back
        ? { back: data.back, notBefore: Date.parse(`${data.date}T18:00:00+05:30`) - 86_400_000 }
        : {}),
    };
    // Save successfully before announcing a place; push acceptance is not proof of device receipt.
    const ok = await W.joinWaitlist(data.date, entry);
    if (!ok) return { ok: false as const, reason: "full" as const };
    const { deliverToGuest } = await import("./push.server");
    const label = new Date(`${data.date}T00:00:00Z`).toLocaleDateString("en-IN", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
    const delivery = await deliverToGuest(entry, {
      title: data.back
        ? `We’ll remind you when ${data.back} is back`
        : `You’re on the waitlist for ${label}`,
      body: data.back
        ? `${data.back} is back ${label}. We’ll send the first free time the evening before · Lumen Studio`
        : "We’ll alert this device if a time opens · Lumen Studio",
      url: "/book",
      tag: `wait-join-${data.date}`,
    });
    return { ok, confirmed: delivery === "sent" };
  });
