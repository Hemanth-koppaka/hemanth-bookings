import { test } from "node:test";
import { strictEqual } from "node:assert";
import { firstAvailableSlot } from "./soonest-slot";
test("closed days are skipped for automatic earliest selection", () => {
  strictEqual(firstAvailableSlot({ closed: true, slots: [{ minute: 540, available: true }] }), null);
});
test("earliest selection respects the selected stylist", () => {
  strictEqual(firstAvailableSlot({ closed: false, slots: [{ minute: 540, available: true, staff: ["a"] }, { minute: 570, available: true, staff: ["b"] }] }, "b"), 570);
});