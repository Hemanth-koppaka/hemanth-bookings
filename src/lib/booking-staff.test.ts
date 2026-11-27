import { test } from "node:test";
import { strictEqual } from "node:assert";
import { rescheduleChoice } from "./booking-staff";

const booking = { staff_id: "original", staff_choice: "specific" };
test("a guest can request a different stylist without retaining the original restriction", () => {
  strictEqual(rescheduleChoice(booking, "new-stylist"), "new-stylist");
});
test("explicit any stylist releases the original restriction", () => {
  strictEqual(rescheduleChoice(booking, null), "any");
});
test("omitted stylist preserves an existing specific choice", () => {
  strictEqual(rescheduleChoice(booking, undefined), "original");
});