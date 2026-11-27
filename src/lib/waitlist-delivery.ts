export type GuestDelivery = "sent" | "gone" | "retry";

export function keepWaiting(outcome: GuestDelivery): boolean {
  return outcome === "retry";
}