import { test } from "node:test";
import { deepStrictEqual, strictEqual } from "node:assert";
import { salonJsonLd } from "./seo";

test("salon structured data follows supplied contact and weekly hours", () => {
  const data = JSON.parse(salonJsonLd(JSON.stringify({ business: { phones: ["+919000000000"], address: "Plot No. 1143, Sector 9, Midtown, Hyderabad – 500000" }, week: [{ day: "Sunday", closed: false, open: 600, close: 1200 }, { day: "Tuesday", closed: true }] }), "https://salon.example.com"));
  strictEqual(data.telephone, "+919000000000");
  strictEqual(data.address.postalCode, "500000");
  deepStrictEqual(data.openingHoursSpecification, [
    { "@type": "OpeningHoursSpecification", dayOfWeek: "https://schema.org/Sunday", opens: "10:00", closes: "20:00" },
    { "@type": "OpeningHoursSpecification", dayOfWeek: "https://schema.org/Tuesday", opens: "00:00", closes: "00:00" },
  ]);
});