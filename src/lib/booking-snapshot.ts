/** Prices come from the persisted, automatically repriced booking; duration stays booked. */
export function bookingSnapshot(row: Record<string, unknown>) {
  const services = (row['services_snapshot'] as { id?: string; name: string; price: number; minutes?: number }[] | null) ?? [];
  if (!services.length) return null;
  return {
    services: services.map((s) => ({ ...s, minutes: s.minutes ?? 30 })),
    minutes: (row['duration_minutes'] as number | null) ?? services.reduce((sum, s) => sum + (s.minutes ?? 30), 0),
    price: (row['price_total'] as number | null) ?? services.reduce((sum, s) => sum + s.price, 0),
  };
}