import { test } from "node:test";
import { strictEqual } from "node:assert";
import { isUpcomingAppointment } from "./upcoming-bookings";

test("past appointments are not upcoming in salon time", () => {
  strictEqual(isUpcomingAppointment({ status: "confirmed", date: "2026-11-08", time: 1080 }, new Date("2026-11-08T12:31:00Z")), false);
});
test("future confirmed appointments remain upcoming", () => {
  strictEqual(isUpcomingAppointment({ status: "confirmed", date: "2026-11-09", time: 600 }, new Date("2026-11-08T12:31:00Z")), true);
});
test("cancelled appointments are never upcoming", () => {
  strictEqual(isUpcomingAppointment({ status: "cancelled", date: "2026-11-09", time: 600 }, new Date("2026-11-08T12:31:00Z")), false);
});