import { test } from "node:test";
import { deepStrictEqual, strictEqual } from "node:assert";
import { popularServiceIds, sortServices } from "./service-popularity";
const services = [
  { id: "basic", name: "Basic Haircut", price: 500, minutes: 30 },
  { id: "m-signature", name: "Kiran’s Signature", price: 1000, minutes: 30 },
  { id: "m-fa-hb", name: "HB Signature Facial", price: 2000, minutes: 60 },
  { id: "beard", name: "Beard Trim", price: 250, minutes: 30 },
];
test("HB services stay first even without bookings and on price sort", () => {
  deepStrictEqual(sortServices(services, "price-asc").slice(0, 2).map((s) => s.id), ["m-signature", "m-fa-hb"]);
});
test("all HB services have the Popular label with zero bookings", () => {
  deepStrictEqual([...popularServiceIds(services, {})], ["m-signature", "m-fa-hb"]);
});
test("non-HB popularity automatically follows booking counts", () => {
  deepStrictEqual(sortServices(services, "popular", { basic: 1, beard: 8 }).slice(2).map((s) => s.id), ["beard", "basic"]);
  strictEqual(popularServiceIds(services, { basic: 1 }).has("basic"), true);
});