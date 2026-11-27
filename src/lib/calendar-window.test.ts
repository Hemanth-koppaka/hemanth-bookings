import { test } from "node:test";
import { deepStrictEqual, strictEqual } from "node:assert";
import { calendarWindow } from "./calendar-window";
test("closed studio days still frame existing appointments", () => {
  deepStrictEqual(calendarWindow({ closed: true, open: 600, close: 1200 }, [{ time: 540, end: 1230 }]), { start: 540, end: 1260 });
});
test("closed days with no bookings keep their closed state", () => {
  strictEqual(calendarWindow({ closed: true, open: 600, close: 1200 }, []), null);
});