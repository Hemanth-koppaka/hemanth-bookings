import { test } from "node:test";
import { deepStrictEqual, strictEqual } from "node:assert";
import { customerPage, customersNewestBookingFirst } from "./customer-filters";

test("women filter includes records beyond the first 40 loaded customers", () => {
  const customers = Array.from({ length: 45 }, (_, i) => ({ id: String(i) }));
  const bookings = customers.map((c, i) => ({ customerId: c.id, audience: i < 40 ? "men" : "women" }));
  const result = customerPage(customers, bookings, "women", 0, 40);
  deepStrictEqual(result.customers.map((c) => c.id), ["40", "41", "42", "43", "44"]);
  deepStrictEqual(result.counts, { all: 45, men: 40, women: 5 });
  strictEqual(result.more, false);
});

test("counts include unique customers and both audiences before selecting a filter", () => {
  const result = customerPage([{ id: "both" }, { id: "none" }], [
    { customerId: "both", audience: "men" }, { customerId: "both", audience: "men" },
    { customerId: "both", audience: "women" }, { customerId: "excluded", audience: "women" },
  ], "all", 0, 40);
  deepStrictEqual(result.counts, { all: 2, men: 1, women: 1 });
});

test("pagination follows filtered matches and counts stay constant across pages", () => {
  const customers = Array.from({ length: 41 }, (_, i) => ({ id: String(i) }));
  const bookings = customers.map((c) => ({ customerId: c.id, audience: "men" }));
  strictEqual(customerPage(customers, bookings, "men", 0, 40).more, true);
  const last = customerPage(customers, bookings, "men", 1, 40);
  deepStrictEqual(last.customers, [{ id: "40" }]);
  deepStrictEqual(last.counts, { all: 41, men: 41, women: 0 });
  strictEqual(last.more, false);
});

test("customers with the latest created booking stay at the top, older and unbooked below", () => {
  const customers = [{ id: "old" }, { id: "none" }, { id: "repeat" }, { id: "middle" }];
  const sorted = customersNewestBookingFirst(customers, [
    { customerId: "repeat", createdAt: "2026-11-01T10:00:00Z" },
    { customerId: "old", createdAt: "2026-11-10T10:00:00Z" },
    { customerId: "middle", createdAt: "2026-11-12T10:00:00Z" },
    { customerId: "repeat", createdAt: "2026-11-13T05:32:00Z" },
  ]);
  deepStrictEqual(sorted.map(c => c.id), ["repeat", "middle", "old", "none"]);
  deepStrictEqual(customers.map(c => c.id), ["old", "none", "repeat", "middle"]);
});

test("newest-booking ordering applies before audience filtering and pagination", () => {
  const bookings = [
    { customerId: "old", audience: "men", createdAt: "2026-11-10T10:00:00Z" },
    { customerId: "new", audience: "men", createdAt: "2026-11-13T10:00:00Z" },
    { customerId: "other", audience: "women", createdAt: "2026-11-14T10:00:00Z" },
  ];
  const sorted = customersNewestBookingFirst([{ id: "old" }, { id: "new" }, { id: "other" }], bookings);
  deepStrictEqual(customerPage(sorted, bookings, "men", 0, 1).customers, [{ id: "new" }]);
  deepStrictEqual(customerPage(sorted, bookings, "men", 1, 1).customers, [{ id: "old" }]);
});