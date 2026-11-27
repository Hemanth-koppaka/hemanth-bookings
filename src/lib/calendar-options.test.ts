import { test } from "node:test";
import { deepStrictEqual, strictEqual } from "node:assert";
import { applyConfig, defaultConfig } from "./salon";
import { closedDateInfo, nearbyOpenDates, groupClosureDates, closureRangeLabel } from "./calendar-options";

test("holiday reason and weekly closure are distinguished", () => {
  try {
    applyConfig({ ...defaultConfig(), exceptions: { "2026-11-12": { closed: true, note: "Salon holiday" } } });
    deepStrictEqual(closedDateInfo("2026-11-12"), { label: "Holiday", reason: "Salon holiday" });
    strictEqual(closedDateInfo("2026-11-09")?.reason, "Weekly closure · Monday");
    strictEqual(closedDateInfo("2026-11-13"), null);
  } finally { applyConfig(defaultConfig()); }
});
test("nearby choices exclude closed and selected dates and sort by distance", () => {
  deepStrictEqual(nearbyOpenDates([{ iso: "2026-11-13", selectable: true }, { iso: "2026-11-12", selectable: true }, { iso: "2026-11-11", selectable: false }, { iso: "2026-11-09", selectable: true }], "2026-11-12").map((d) => d.iso), ["2026-11-13", "2026-11-09"]);
});

test("continuous holiday dates form one range across months", () => {
  const dates = Array.from({ length: 14 }, (_, i) => ({ iso: new Date(Date.UTC(2026, 10, 23 + i)).toISOString().slice(0, 10), reason: "Private event" }));
  const ranges = groupClosureDates(dates);
  deepStrictEqual(ranges, [{ start: "2026-11-23", end: "2026-12-06", reason: "Private event" }]);
  const range = ranges[0];
  if (!range) throw new Error("Expected a consolidated closure range");
  strictEqual(closureRangeLabel(range), "23 Nov – 6 Dec");
});

test("gaps split closure ranges", () => {
  deepStrictEqual(groupClosureDates([{ iso: "2026-11-23", reason: "Holiday" }, { iso: "2026-11-25", reason: "Holiday" }]), [
    { start: "2026-11-23", end: "2026-11-23", reason: "Holiday" },
    { start: "2026-11-25", end: "2026-11-25", reason: "Holiday" },
  ]);
});

test("different reasons remain separate even on consecutive dates", () => {
  strictEqual(groupClosureDates([{ iso: "2026-11-23", reason: "Holiday" }, { iso: "2026-11-24", reason: "Private event" }]).length, 2);
});