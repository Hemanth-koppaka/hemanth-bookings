import { test } from "node:test";
import { strictEqual } from "node:assert";
import { bookingStatus } from "./booking-status";

test("confirmed booking without a workflow override remains confirmed in the list", () => {
  strictEqual(bookingStatus("confirmed", undefined), "upcoming");
});
test("completed salon appointment is distinguished from its confirmed guest state", () => {
  strictEqual(bookingStatus("confirmed", "completed"), "completed");
});
test("cancelled guest appointment is cancelled even with a stale workflow state", () => {
  strictEqual(bookingStatus("cancelled", "upcoming"), "cancelled");
});