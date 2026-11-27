import { test } from "node:test";
import { strictEqual } from "node:assert";
import { keepWaiting } from "./waitlist-delivery";

test("failed waitlist notifications retain the customer's place for retry", () => {
  strictEqual(keepWaiting("retry"), true);
});
test("accepted alerts and unsubscribed devices are removed from the waitlist", () => {
  strictEqual(keepWaiting("sent"), false);
  strictEqual(keepWaiting("gone"), false);
});