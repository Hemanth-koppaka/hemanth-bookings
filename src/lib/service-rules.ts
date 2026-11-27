// Who may perform a service. Most services use every qualified stylist
// ("any"); some prefer one stylist, e.g. Kiran's Signature → Kiran. A
// preferred service is booked with that stylist unless the guest explicitly
// chooses another stylist from its fallback pool (never substituted silently).

/** As configured by the salon (Admin → Services), per service record id. */
export type ServiceRuleSetting =
  { mode: "any" } | { mode: "preferred"; stylist: string } | { mode: "only"; stylist: string };

/** As resolved for booking: the preferred stylist and who may stand in. */
export type ServiceRule = {
  preferred: string;
  preferredName: string;
  fallback: string[];
  /** Only this stylist performs it: closed while they're away (no stand-in). */
  only?: boolean;
  /** "only" services: the stylist isn't taking bookings at all right now. */
  off?: boolean;
  /** "only" services: the stylist's leave from today on (inclusive dates). */
  away?: { start: string; end: string }[];
};

/** An "only" rule's stylist is away (on leave or not taking bookings) on this date. */
export function onlyAwayOn(rule: ServiceRule | null | undefined, iso: string): boolean {
  if (!rule?.only) return false;
  return Boolean(rule.off) || (rule.away ?? []).some((a) => a.start <= iso && iso <= a.end);
}

export const SIGNATURE_RE = /kiran.?s signature/i;

/** The preferred stylist across these services (first preferred rule wins). */
export function preferredFor(
  serviceIds: string[],
  rules: Record<string, ServiceRule>,
): ServiceRule | null {
  for (const id of serviceIds) if (rules[id]) return rules[id];
  return null;
}
