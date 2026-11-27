import { test } from "node:test";
import { strictEqual } from "node:assert";
import { isBookingAlert, receivesBookingAlert } from "./booking-alert-policy";
test("unrelated admin actions cannot become booking alerts", () => {
  strictEqual(isBookingAlert("settings.update"), false);
  strictEqual(isBookingAlert("BOOKING_UPDATED"), true);
});
test("only the assigned stylist receives another guest's update", () => {
  strictEqual(receivesBookingAlert({ staffId: "a" }, "b"), false);
  strictEqual(receivesBookingAlert({ staffId: "b" }, "b"), true);
});
test("staff-only delivery excludes owner broadcasts", () => {
  strictEqual(receivesBookingAlert({}, "b", true), false);
});