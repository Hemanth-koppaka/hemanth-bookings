export type SortKey = "popular" | "rating" | "price-asc" | "price-desc" | "duration";
type RankedService = {
  id: string;
  name: string;
  price: number;
  minutes: number;
  rating?: { avg: number; count: number } | undefined;
};
const SIGNATURE_IDS = new Set(["m-signature", "w-signature", "m-fa-sig", "w-fa-sig"]);
export const isSignatureService = (s: { id: string; name: string }) =>
  SIGNATURE_IDS.has(s.id) || /\bsignature\b/i.test(s.name);

export function sortServices<T extends RankedService>(
  list: T[],
  key: SortKey,
  counts: Record<string, number> = {},
) {
  return list
    .map((x, i) => ({ x, i }))
    .sort((a, b) => {
      const brand = Number(isSignatureService(b.x)) - Number(isSignatureService(a.x));
      if (brand) return brand;
      if (key === "price-asc") return a.x.price - b.x.price || a.i - b.i;
      if (key === "price-desc") return b.x.price - a.x.price || a.i - b.i;
      if (key === "duration") return a.x.minutes - b.x.minutes || a.i - b.i;
      if (key === "rating") {
        const rating = (s: T) => (s.rating && s.rating.count >= 3 ? s.rating.avg : 0);
        return (
          rating(b.x) - rating(a.x) ||
          (b.x.rating?.count ?? 0) - (a.x.rating?.count ?? 0) ||
          a.i - b.i
        );
      }
      return (counts[b.x.id] ?? 0) - (counts[a.x.id] ?? 0) || a.i - b.i;
    })
    .map((s) => s.x);
}

export function popularServiceIds(
  services: { id: string; name: string }[],
  counts: Record<string, number>,
) {
  const mostBooked = services
    .filter((s) => (counts[s.id] ?? 0) > 0)
    .sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0))
    .slice(0, 3);
  return new Set([...services.filter(isSignatureService), ...mostBooked].map((s) => s.id));
}
