import { test } from "node:test";
import { strictEqual } from "node:assert";
import { isRepeatBooking } from "./repeat-booking";
const visit = { status: "confirmed", date: "2099-11-14", time: 600, serviceIds: ["cut", "beard"], customer: { phone: "+91 9876543210" } };
test("repeat warning matches same customer and services regardless of order", () => { strictEqual(isRepeatBooking(visit, ["beard", "cut"], "9876543210"), true); });
test("cancelled visits do not trigger repeat warnings", () => { strictEqual(isRepeatBooking({ ...visit, status: "cancelled" }, ["cut", "beard"], "9876543210"), false); });