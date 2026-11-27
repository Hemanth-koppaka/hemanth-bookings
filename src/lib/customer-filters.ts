export type CustomerFilter = "all" | "men" | "women";
export type CustomerCounts = Record<CustomerFilter, number>;

/** Newest booking creation wins; profile edits and reusable numbers never affect order. */
export function customersNewestBookingFirst<T extends { id: string }>(
  customers: T[],
  bookings: { customerId: string | null; createdAt: string }[],
): T[] {
  const latest = new Map<string, number>();
  for (const booking of bookings) {
    if (!booking.customerId) continue;
    const at = Date.parse(booking.createdAt);
    if (!Number.isFinite(at)) continue;
    latest.set(booking.customerId, Math.max(latest.get(booking.customerId) ?? 0, at));
  }
  return [...customers].sort((a, b) =>
    (latest.get(b.id) ?? 0) - (latest.get(a.id) ?? 0) || a.id.localeCompare(b.id),
  );
}

/** Filter before pagination, counting unique customers rather than appointments. */
export function customerPage<T extends { id: string }>(
  customers: T[],
  bookings: { customerId: string | null; audience: string }[],
  filter: CustomerFilter,
  page: number,
  size: number,
) {
  const audiences = new Map<string, Set<string>>();
  for (const booking of bookings) {
    if (!booking.customerId) continue;
    const values = audiences.get(booking.customerId) ?? new Set<string>();
    values.add(booking.audience);
    audiences.set(booking.customerId, values);
  }
  const counts: CustomerCounts = { all: customers.length, men: 0, women: 0 };
  for (const customer of customers) {
    const values = audiences.get(customer.id);
    if (values?.has("men")) counts.men++;
    if (values?.has("women")) counts.women++;
  }
  const matches = filter === "all" ? customers : customers.filter((c) => audiences.get(c.id)?.has(filter));
  return { customers: matches.slice(page * size, (page + 1) * size), counts, more: matches.length > (page + 1) * size };
}