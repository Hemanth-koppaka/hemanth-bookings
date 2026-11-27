import { test } from "node:test";
import { strictEqual } from "node:assert";
import { applyConfig, calendarDays, defaultConfig } from "./salon";

test("a holiday cannot be selected while the adjacent open day can", () => {
  try {
    applyConfig({ ...defaultConfig(), exceptions: { "2026-11-12": { closed: true } } });
    const days = calendarDays(7, new Date(2026, 10, 8));
    strictEqual(days.find((day) => day.iso === "2026-11-12")?.selectable, false);
    strictEqual(days.find((day) => day.iso === "2026-11-13")?.selectable, true);
  } finally {
    applyConfig(defaultConfig());
  }
});

test("every day of a salon closure is unselectable, including both endpoints", () => {
  try {
    applyConfig({ ...defaultConfig(), closures: [{ start: "2026-11-12", end: "2026-11-14", reason: "Holiday" }] });
    const days = calendarDays(8, new Date(2026, 10, 8));
    for (const iso of ["2026-11-12", "2026-11-13", "2026-11-14"]) {
      strictEqual(days.find((day) => day.iso === iso)?.selectable, false);
    }
    strictEqual(days.find((day) => day.iso === "2026-11-15")?.selectable, true);
  } finally {
    applyConfig(defaultConfig());
  }
});

test("the weekly closed day is unselectable", () => {
  applyConfig(defaultConfig());
  strictEqual(calendarDays(7, new Date(2026, 10, 8)).find((day) => day.iso === "2026-11-09")?.selectable, false);
});