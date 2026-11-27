import { loadStore, stable } from "./staff-store.server";
import { expandedWorkingWindow } from "./business-hours-policy";

/** Keep both real-table and legacy staff schedules reachable from edited salon hours. */
export async function syncWorkingHours(hours: { day: number; open: boolean; from: string; to: string }[]) {
  const store = await loadStore();
  const minutes = (time: string) => {
    const [hour = 0, minute = 0] = time.split(":").map(Number);
    return hour * 60 + minute;
  };
  // Sequential updates also preserve unrelated rows in the legacy JSON store.
  for (const shift of store.staff_working_hours) {
    const day = hours.find((h) => h.day === shift["day_of_week"]);
    if (!day) continue;
    const window = expandedWorkingWindow(
      { working: shift["is_working"] === true, start: Number(shift["start_minute"]), end: Number(shift["end_minute"]) },
      { open: day.open, start: minutes(day.from), end: minutes(day.to) },
    );
    if (!window) continue;
    const { error } = await stable("staff_working_hours")
      .update({ start_minute: window.start, end_minute: window.end })
      .eq("staff_id", shift["staff_id"])
      .eq("day_of_week", day.day)
      .eq("is_working", true);
    if (error) throw new Error("Couldn't update stylist hours. Please save business hours again.");
  }
  (await import("./config.server")).invalidateConfig();
}
/** Stylist breaks that copied an old salon-wide break would keep blocking after the salon break moves. */
export async function retireMirroredStaffBreaks(previous: Record<string, { start: string; end: string }[]>) {
  const minutes = (time: string) => {
    const [hour = 0, minute = 0] = time.split(":").map(Number);
    return hour * 60 + minute;
  };
  const old = new Set(Object.values(previous).flat().map((b) => `${minutes(b.start)}-${minutes(b.end)}`));
  const store = await loadStore();
  for (const b of store.staff_breaks) {
    if (!old.has(`${Number(b["start_minute"])}-${Number(b["end_minute"])}`)) continue;
    const { error } = await stable("staff_breaks").delete().eq("id", b["id"]);
    if (error) throw new Error("Couldn't update stylist breaks. Please save again.");
  }
  (await import("./config.server")).invalidateConfig();
}
