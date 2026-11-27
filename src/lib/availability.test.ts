import { test } from "node:test";
import { strictEqual } from "node:assert";
import { computeStaffSlots, type StaffAvailabilityInput } from "./availability";

const morning: StaffAvailabilityInput = {
  plan: { closed: false, open: 540, close: 1170, breaks: [{ start: 780, end: 840 }], blocks: [] },
  interval: 30, duration: 30, buffer: 0, now: 488, notice: 30, choice: "any",
  staff: [{ id: "stylist", name: "Stylist", start: 540, end: 1200, breaks: [{ start: 780, end: 840 }], blocks: [], busy: [] }],
};

test("9:00 AM is available with a 9 AM staff start", () => {
  strictEqual(computeStaffSlots(morning).find((s) => s.minute === 540)?.available, true);
});

test("9:30 AM is available with a 9 AM staff start", () => {
  strictEqual(computeStaffSlots(morning).find((s) => s.minute === 570)?.available, true);
});

test("opening earlier does not bypass lunch, occupied or past times", () => {
  strictEqual(computeStaffSlots(morning).find((s) => s.minute === 780)?.available, false);
  strictEqual(computeStaffSlots({ ...morning, now: 600 }).find((s) => s.minute === 540)?.available, false);
  const staff = morning.staff.map((s) => ({ ...s, busy: [{ start: 540, end: 570 }] }));
  strictEqual(computeStaffSlots({ ...morning, staff }).find((s) => s.minute === 540)?.available, false);
});