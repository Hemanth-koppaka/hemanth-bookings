import { test } from "node:test";
import { deepStrictEqual, strictEqual } from "node:assert";
import { expandedWorkingWindow } from "./business-hours-policy";
import { computeStaffSlots } from "./availability";

test("an 8 AM weekend opening makes 8 AM and 8:30 AM bookable despite the old 9 AM start", () => {
  const window = expandedWorkingWindow(
    { working: true, start: 540, end: 1200 },
    { open: true, start: 480, end: 1170 },
  );
  deepStrictEqual(window, { start: 480, end: 1200 });
  if (!window) throw new Error("Working window must expand");
  const slots = computeStaffSlots({
    plan: { closed: false, open: 480, close: 1170, breaks: [], blocks: [] },
    interval: 30, duration: 30, buffer: 0, now: null, notice: 30, choice: "stylist",
    staff: [{ id: "stylist", name: "Stylist", ...window, breaks: [{ start: 780, end: 840 }], blocks: [], busy: [] }],
  });
  strictEqual(slots.find((s) => s.minute === 480)?.available, true);
  strictEqual(slots.find((s) => s.minute === 510)?.available, true);
  strictEqual(slots.find((s) => s.minute === 780)?.available, false);
});

test("business-hour edits preserve explicit staff days off and salon closed days", () => {
  strictEqual(expandedWorkingWindow({ working: false, start: 540, end: 1200 }, { open: true, start: 480, end: 1170 }), null);
  strictEqual(expandedWorkingWindow({ working: true, start: 540, end: 1200 }, { open: false, start: 480, end: 1170 }), null);
});