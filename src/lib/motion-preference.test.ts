import { test } from "node:test";
import { strictEqual } from "node:assert";
import { prefersLessMotion } from "./motion-preference";

test("saved less-motion option keeps logo motion off", () => {
  strictEqual(prefersLessMotion("reduce", false), true);
  strictEqual(prefersLessMotion("full", false), false);
});
test("device reduced-motion preference is always respected", () => {
  strictEqual(prefersLessMotion("full", true), true);
  strictEqual(prefersLessMotion(null, true), true);
});