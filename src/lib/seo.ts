// What search engines read about the salon: a schema.org HairSalon record
// (name, address, map position, phone, opening hours, services with prices,
// Instagram), built from the live configuration so it always matches what
// the salon set in the admin console. Shown on every page as JSON-LD.
import { BUSINESS, type SalonConfig, type WeekDay } from "./salon";
import { SALON_LAT, SALON_LON } from "./sun";

const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** "Plot 1143, …, Midtown, Metro City – 500000" → schema.org PostalAddress. */
function postalAddress(address: string) {
  const pin = /(\d{6})/.exec(address)?.[1];
  const parts = address
    .replace(/[–-]\s*\d{6}/, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    "@type": "PostalAddress",
    streetAddress: parts.slice(0, Math.max(1, parts.length - 2)).join(", "),
    addressLocality: "Metro City",
    addressRegion: "Telangana",
    ...(pin ? { postalCode: pin } : {}),
    addressCountry: "IN",
  };
}

export function salonJsonLd(configJson: string, origin: string) {
  let cfg: SalonConfig = {};
  try {
    cfg = JSON.parse(configJson) as SalonConfig;
  } catch {
    /* defaults below */
  }
  const b = { ...BUSINESS, ...(cfg.business ?? {}) };
  const week = (cfg.week ?? []) as WeekDay[];
  const hours = week.flatMap((d) => {
    if (d.closed)
      return [
        {
          "@type": "OpeningHoursSpecification",
          dayOfWeek: `https://schema.org/${d.day}`,
          opens: "00:00",
          closes: "00:00",
        },
      ];
    if (d.open == null || d.close == null) return [];
    return [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: `https://schema.org/${d.day}`,
        opens: hhmm(d.open),
        closes: hhmm(d.close),
      },
    ];
  });
  const offers = [
    ...((cfg.menMenu ?? []).map((c) => ({ c, who: "Men" })) ?? []),
    ...((cfg.womenMenu ?? []).map((c) => ({ c, who: "Women" })) ?? []),
  ].map(({ c, who }) => ({
    "@type": "OfferCatalog",
    name: `${who} · ${c.title}`,
    itemListElement: c.services.slice(0, 40).map((s) => ({
      "@type": "Offer",
      price: String(s.price),
      priceCurrency: "INR",
      itemOffered: { "@type": "Service", name: s.name, ...(s.note ? { description: s.note } : {}) },
    })),
  }));
  const abs = (p: string) => (origin ? new URL(p, origin).toString() : undefined);
  const data = {
    "@context": "https://schema.org",
    "@type": "HairSalon",
    "@id": `${origin || "https://salon.example.com"}/#salon`,
    name: b.name,
    alternateName: b.brand,
    description: `Cuts, colour and care by ${b.founder} at ${b.locationShort}. Book online in under a minute.`,
    ...(origin
      ? { url: origin, image: abs("/brand/brand-emblem.webp"), logo: abs("/icons/app-512.png") }
      : {}),
    telephone: b.phones?.[0],
    contactPoint: (b.phones ?? []).map((phone) => ({
      "@type": "ContactPoint",
      telephone: phone,
      contactType: "reservations",
    })),
    address: postalAddress(b.address),
    geo: { "@type": "GeoCoordinates", latitude: SALON_LAT, longitude: SALON_LON },
    hasMap: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.mapsQuery)}`,
    ...(hours.length ? { openingHoursSpecification: hours } : {}),
    priceRange: "₹₹",
    currenciesAccepted: "INR",
    founder: { "@type": "Person", name: b.founder },
    sameAs: [b.instagram?.salon?.url, b.instagram?.kiran?.url].filter(Boolean),
    ...(offers.length
      ? { hasOfferCatalog: { "@type": "OfferCatalog", name: "Services", itemListElement: offers } }
      : {}),
    ...(origin
      ? {
          potentialAction: {
            "@type": "ReserveAction",
            target: abs("/book"),
            name: "Book an appointment",
          },
        }
      : {}),
  };
  // safe inside a <script> tag
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
