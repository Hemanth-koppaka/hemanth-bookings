/*
 * Day availability with a short-lived cache, shared by the Services and Time
 * screens: a day already fetched shows instantly (and refreshes quietly), and
 * the Services screen can start loading the first open day before the guest
 * reaches the Time screen.
 */
import { getAvailability } from "@/lib/salon.functions";
import type { DayAvailability } from "@/lib/engine.server";
import { calendarDays } from "@/lib/salon";

export const FRESH_MS = 60_000;
export const dayCache = new Map<string, { at: number; data: DayAvailability }>();
const inflight = new Map<string, Promise<DayAvailability>>();
export const cacheKey = (date: string, audience: string, key: string) =>
  `${date}|${audience}|${key}`;

export function fetchDay(
  date: string,
  audience: string,
  key: string,
  force = false,
): Promise<DayAvailability> {
  const k = cacheKey(date, audience, key);
  const hit = dayCache.get(k);
  if (!force && hit && Date.now() - hit.at < FRESH_MS) return Promise.resolve(hit.data);
  const running = inflight.get(k);
  if (running) return running;
  const p = getAvailability({
    data: { date, audience: audience as "men" | "women", serviceIds: key.split(",") },
  })
    .then((r) => {
      dayCache.set(k, { at: Date.now(), data: r });
      return r;
    })
    .finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}

/**
 * Start loading the day the Time screen opens on (the first open day), so its
 * times are ready, or nearly, when the guest gets there. Read-only and cached.
 */
export function warmFirstDay(audience: string | null | undefined, serviceIds: string[]) {
  if (!audience || !serviceIds.length || typeof window === "undefined") return;
  const first = calendarDays(14).find((d) => d.selectable);
  if (first) void fetchDay(first.iso, audience, serviceIds.join(",")).catch(() => {});
}
