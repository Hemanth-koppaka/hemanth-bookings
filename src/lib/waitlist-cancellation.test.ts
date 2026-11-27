import { describe, it } from "node:test";
import { strictEqual } from "node:assert";
import { matchesWaitlistEntry, type WaitlistProof } from "./waitlist-cancellation";

const proof: WaitlistProof = { date: "2026-11-13", endpoint: "https://push.example/device", p256dh: "public-key", auth: "secret", audience: "men", serviceIds: ["m-signature", "m-fa-hb"], staffId: "stylist-a" };
const entry = { endpoint: proof.endpoint, keys: { p256dh: proof.p256dh, auth: proof.auth }, audience: proof.audience, serviceIds: [...proof.serviceIds].reverse(), staffId: proof.staffId };

describe("waitlist cancellation ownership", () => {
  it("allows the same device and exact criteria regardless of service order", () => {
    strictEqual(matchesWaitlistEntry(proof.date, entry, proof), true);
  });
  it("rejects another device or incorrect subscription secrets", () => {
    for (const change of [{ endpoint: "https://push.example/other" }, { auth: "wrong" }, { p256dh: "wrong" }]) {
      strictEqual(matchesWaitlistEntry(proof.date, entry, { ...proof, ...change }), false);
    }
  });
  it("cannot cancel other dates, services, audiences or stylists", () => {
    strictEqual(matchesWaitlistEntry("2026-11-14", entry, proof), false);
    for (const change of [{ serviceIds: ["m-signature"] }, { audience: "women" as const }, { staffId: "stylist-b" }, { staffId: undefined }]) {
      strictEqual(matchesWaitlistEntry(proof.date, entry, { ...proof, ...change }), false);
    }
  });
});