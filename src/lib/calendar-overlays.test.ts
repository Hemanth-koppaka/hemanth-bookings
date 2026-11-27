import { test } from "node:test";
import { deepStrictEqual } from "node:assert";
import { calendarOverlays } from "./calendar-overlays";

test("duplicate salon and stylist breaks display a single interval", () => {
  deepStrictEqual(calendarOverlays([
    { start: 780, end: 840, label: "Break", kind: "break" },
    { start: 780, end: 840, label: "Break", kind: "break" },
  ], 540, 1200), [{ start: 780, end: 840, label: "Break", kind: "break" }]);
});

test("overlapping reasons occupy distinct slices without losing blocked time", () => {
  deepStrictEqual(calendarOverlays([
    { start: 780, end: 840, label: "Break", kind: "break" },
    { start: 810, end: 870, label: "Personal work", kind: "block" },
  ], 540, 1200), [
    { start: 780, end: 810, label: "Break", kind: "break" },
    { start: 810, end: 840, label: "Break · Personal work", kind: "block" },
    { start: 840, end: 870, label: "Personal work", kind: "block" },
  ]);
});

test("overlays stay within opening hours and omit invalid intervals", () => {
  deepStrictEqual(calendarOverlays([
    { start: 500, end: 570, label: "Break", kind: "break" },
    { start: 1210, end: 1250, label: "Closed", kind: "block" },
    { start: 800, end: 700, label: "Invalid", kind: "break" },
  ], 540, 1200), [{ start: 540, end: 570, label: "Break", kind: "break" }]);
});