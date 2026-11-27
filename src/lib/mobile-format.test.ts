import { test } from "node:test";
import { strictEqual } from "node:assert";
import { isValidMobile, mobileDigits } from "./salon";
test("accept country code and spaces for a full Indian number", () => {
  strictEqual(isValidMobile("+91 98765 43210"), true);
  strictEqual(mobileDigits("+91 98765 43210"), "9876543210");
});
test("accept unspaced country code", () => { strictEqual(isValidMobile("+919876543210"), true); });
test("the supplied nine-digit examples need the missing digit", () => {
  strictEqual(isValidMobile("+91 98765 4321"), false);
  strictEqual(isValidMobile("+91 987654321"), false);
});