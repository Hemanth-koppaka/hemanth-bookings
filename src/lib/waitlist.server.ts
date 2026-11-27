// "Tell me if a time opens up": guests looking at a full day can ask to be
// told (free phone notification) if a time that fits their services frees up
// on that day. When a booking on that day is cancelled or moved away, everyone
// waiting is checked against the real availability and told once, first come
// first served. Entries for past days are dropped.
import { supabaseAdmin as sb } from "@/integrations/supabase/client.server";
import { keepWaiting } from "./waitlist-delivery";
import { matchesWaitlistEntry, type WaitlistProof } from "./waitlist-cancellation";

export type WaitEntry = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  origin: string;
  audience: "men" | "women";
  serviceIds: string[];
  staffId?: string;
  at: number;
  /** "Remind me when Kiran is back": not told before this time (ms), with their name. */
  notBefore?: number;
  back?: string;
};

export async function joinWaitlist(date: string, e: WaitEntry) {
  const { data, error } = await sb.rpc("join_customer_waitlist", {
    p_date: date,
    p_entry: e as never,
  });
  if (error) throw new Error("Couldn't save waitlist subscription");
  return data === true;
}

const clock = (m: number) => {
  const h = Math.floor(m / 60);
  return `${((h + 11) % 12) + 1}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

export async function cancelWaitlist(proof: WaitlistProof) {
  const { data: rows, error } = await sb
    .from("customer_waitlist")
    .select("id,date,entry")
    .eq("date", proof.date)
    .eq("entry->>endpoint", proof.endpoint);
  if (error) throw new Error("Couldn't check waitlist subscription");
  for (const row of rows ?? []) {
    if (!row.entry || !matchesWaitlistEntry(row.date, row.entry, proof)) continue;
    // Compare the saved version too: do not erase a concurrent replacement join.
    const { error: removalError, data: removed } = await sb
      .from("customer_waitlist")
      .delete()
      .eq("id", row.id)
      .eq("entry", JSON.stringify(row.entry))
      .select("id");
    if (removalError || !removed?.length) throw new Error("Couldn't remove waitlist subscription");
  }
  return { ok: true as const };
}

/** A booking on `date` was cancelled or moved away: tell those waiting if their services now fit. */
export async function timeFreedOn(date: string) {
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  if (date < today) return 0;
  const { data: rows, error } = await sb.rpc("claim_customer_waitlist", { p_date: date });
  if (error) throw new Error("Couldn't claim waitlist subscriptions");
  const list = (rows ?? []) as { id: string; entry: unknown }[];
  if (!list.length) return 0;
  const { engine } = await import("./bookings.server");
  const E = await engine(true);
  const rules = await E.loadRules();
  const { deliverToGuest } = await import("./push.server");
  let told = 0;
  await Promise.all(
    list.map(async (row) => {
      const w = row.entry as WaitEntry;
      const remove = async () => {
        const { error } = await sb
          .from("customer_waitlist")
          .delete()
          .eq("id", row.id)
          .eq("entry", JSON.stringify(row.entry));
        if (error) throw new Error("Couldn't update waitlist delivery");
      };
      if (w.notBefore && Date.now() < w.notBefore) return; // a "when they're back" reminder, not due yet
      const q = E.quote(w.audience, w.serviceIds);
      if (!q) return remove(); // services no longer offered
      const day = await E.availability(date, q, rules, {
        serviceIds: w.serviceIds,
        ...(w.staffId ? { choice: w.staffId } : {}),
      });
      const slot = day.slots.find(
        (s) => s.available && (!w.staffId || !s.staff || s.staff.includes(w.staffId)),
      );
      if (!slot) {
        return;
      }
      const label = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", {
        weekday: "short",
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      });
      const url = `/open-time?d=${date}&a=${w.audience}&s=${encodeURIComponent(w.serviceIds.join(","))}${w.staffId ? `&st=${w.staffId}` : ""}`;
      // Cancellation may have removed an entry while availability was being checked.
      const { data: active, error: activeError } = await sb
        .from("customer_waitlist")
        .select("id")
        .eq("id", row.id)
        .eq("entry", JSON.stringify(row.entry))
        .maybeSingle();
      if (activeError) throw new Error("Couldn't check waitlist delivery");
      if (!active) return;
      const result = await deliverToGuest(w, {
        title: w.back
          ? `${w.back} is back ${label} · first free time ${clock(slot.minute)}`
          : `A time just opened: ${label}, ${clock(slot.minute)}`,
        body: w.back
          ? "Tap to book your appointment · Hair by Kiran"
          : "Tap to book it before someone else does · Hair by Kiran",
        url,
        tag: `wait-${date}`,
      });
      if (keepWaiting(result)) return; // the scheduled dispatcher retries after the lease expires
      await remove();
      if (result === "sent") told++; // told once; they book (or not) from the link
    }),
  );
  return told;
}

/** Periodic recovery does not depend on another customer cancelling. */
export async function dispatchWaitlist() {
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const { error: cleanupError } = await sb.from("customer_waitlist").delete().lt("date", today);
  if (cleanupError) throw new Error("Couldn't expire past waitlists");
  const { data, error } = await sb
    .from("customer_waitlist")
    .select("date")
    .gte("date", today)
    .or(`claimed_until.is.null,claimed_until.lt.${new Date().toISOString()}`)
    .order("created_at")
    .limit(200);
  if (error) throw new Error("Couldn't read pending waitlists");
  let sent = 0;
  for (const date of new Set((data ?? []).map((row) => row.date))) sent += await timeFreedOn(date);
  return { sent };
}
