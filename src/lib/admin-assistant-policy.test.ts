import { test } from "node:test";
import assert from "node:assert/strict";
import { explicitDecision, safeAssistantArguments } from "./admin-assistant-policy";

test("only an explicit confirmation authorizes the pending exact change", () => {
  assert.equal(explicitDecision("Yes, go ahead"), "confirm");
  assert.equal(explicitDecision("yes go ahead"), "confirm");
  assert.equal(explicitDecision("yes but move it to 3 PM"), null);
  assert.equal(explicitDecision("cancel"), "cancel");
});
test("model cannot supply admin credentials or override existing bookings", () => {
  assert.throws(() => safeAssistantArguments({ pin: "injected" }));
  assert.throws(() =>
    safeAssistantArguments({ confirm: true, date: "2026-11-11", start: 840, end: 900 }),
  );
  assert.deepEqual(safeAssistantArguments({ date: "2026-11-11", start: 840, end: 900 }), {
    date: "2026-11-11",
    start: 840,
    end: 900,
  });
});
test("guest references remain usable but cannot be replaced through assistant fields", () => {
  assert.deepEqual(
    safeAssistantArguments({ reference: "BK-6PUR6U", patch: { meta: { status: "completed" } } }),
    { reference: "BK-6PUR6U", patch: { meta: { status: "completed" } } },
  );
  assert.throws(() => safeAssistantArguments({ reference_new: "BK-CHANGED" }));
  assert.throws(() => safeAssistantArguments({ patch: { booking_no: 17 } }));
});
