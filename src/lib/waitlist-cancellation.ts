export type WaitlistProof = {
  date: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  audience: "men" | "women";
  serviceIds: string[];
  staffId?: string | undefined;
};

/** Subscription secrets authorize only this device's exact appointment criteria. */
export function matchesWaitlistEntry(date: string, entry: unknown, proof: WaitlistProof): boolean {
  if (date !== proof.date || !entry || typeof entry !== "object") return false;
  const e = entry as Record<string, unknown>;
  const keys = e["keys"] as Record<string, unknown> | undefined;
  const services = e["serviceIds"];
  return e["endpoint"] === proof.endpoint && keys?.["p256dh"] === proof.p256dh &&
    keys?.["auth"] === proof.auth && e["audience"] === proof.audience &&
    (e["staffId"] ?? null) === (proof.staffId ?? null) &&
    Array.isArray(services) && services.every((id) => typeof id === "string") &&
    JSON.stringify([...services].sort()) === JSON.stringify([...proof.serviceIds].sort());
}