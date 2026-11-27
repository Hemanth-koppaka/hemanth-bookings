import { useEffect, useState } from "react";
import { BellRing, Check, Phone, X } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { cancelWaitlist, joinWaitlist, pushPublicKey } from "@/lib/salon.functions";
import { BUSINESS, fromISO } from "@/lib/salon";
import { haptic } from "@/lib/utils";

type Props = {
  date: string;
  audience: string;
  serviceIds: string[];
  staffId?: string | null | undefined;
  rescheduling?: boolean;
  /** "Remind me when <name> is back": `date` is the day they're back */
  back?: string | undefined;
};
const keyBytes = (b64: string) => {
  const t = b64.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(t + "===".slice((t.length + 3) % 4)), (c) => c.charCodeAt(0));
};

export function WaitlistOption({ date, audience, serviceIds, staffId, rescheduling, back }: Props) {
  const [state, setState] = useState<
    "checking" | "off" | "busy" | "on" | "cancelling" | "removed" | "blocked" | "unsupported"
  >("checking");
  const cancelEntry = useServerFn(cancelWaitlist);
  const joinEntry = useServerFn(joinWaitlist);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState<boolean | null>(null);
  const servicesKey = serviceIds.join(",");
  const cacheKey = `hb.wait.v2.${date}.${audience}.${servicesKey}.${staffId ?? "any"}${back ? ".back" : ""}`;
  useEffect(() => {
    const removed = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== cacheKey) return;
      setConfirmed(null);
      setError("");
      setState("removed");
    };
    window.addEventListener("hb:waitlist-removed", removed);
    return () => window.removeEventListener("hb:waitlist-removed", removed);
  }, [cacheKey]);
  useEffect(() => {
    setError("");
    setConfirmed(null);
    if (!("serviceWorker" in navigator && "PushManager" in window && "Notification" in window))
      return setState("unsupported");
    let saved = false;
    try {
      saved = localStorage.getItem(cacheKey) === "1";
    } catch {
      /* optional storage */
    }
    setState(saved ? "on" : Notification.permission === "denied" ? "blocked" : "off");
  }, [cacheKey]);
  const label = fromISO(date).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const join = async () => {
    if ((state !== "off" && state !== "removed") || (audience !== "men" && audience !== "women"))
      return;
    setState("busy");
    setError("");
    try {
      if ((await Notification.requestPermission()) !== "granted") {
        setState("blocked");
        return;
      }
      const reg = await navigator.serviceWorker.register("/admin-sw.js");
      await navigator.serviceWorker.ready;
      const { publicKey } = await pushPublicKey();
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(publicKey) as BufferSource,
        }));
      const json = sub.toJSON();
      const p256dh = json.keys?.["p256dh"];
      const auth = json.keys?.["auth"];
      if (!json.endpoint || !p256dh || !auth) throw new Error("subscription");
      const result = await joinEntry({
        data: {
          date,
          audience,
          serviceIds: servicesKey.split(","),
          ...(staffId ? { staffId } : {}),
          ...(back ? { back } : {}),
          endpoint: json.endpoint,
          p256dh,
          auth,
          origin: location.origin,
        },
      });
      if (!result.ok) throw new Error("waitlist");
      setConfirmed("confirmed" in result ? result.confirmed : null);
      try {
        localStorage.setItem(cacheKey, "1");
      } catch {
        /* optional storage */
      }
      haptic();
      setState("on");
    } catch {
      setState("off");
      setError("We couldn’t add you to the waitlist. Please try again.");
    }
  };
  const cancel = async () => {
    if (state !== "on" || (audience !== "men" && audience !== "women")) return;
    setState("cancelling");
    setError("");
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      const json = sub?.toJSON();
      const p256dh = json?.keys?.["p256dh"];
      const auth = json?.keys?.["auth"];
      if (!json?.endpoint || !p256dh || !auth) throw new Error("subscription");
      const result = await cancelEntry({
        data: {
          date,
          audience,
          serviceIds: servicesKey.split(","),
          ...(staffId ? { staffId } : {}),
          endpoint: json.endpoint,
          p256dh,
          auth,
        },
      });
      if (!result.ok) throw new Error("waitlist");
      try {
        localStorage.removeItem(cacheKey);
      } catch {
        /* optional storage */
      }
      setConfirmed(null);
      setState("removed");
      window.dispatchEvent(new CustomEvent("hb:waitlist-removed", { detail: cacheKey }));
      haptic();
    } catch {
      setState("on");
      setError("We couldn’t remove your waitlist entry. Please try again.");
    }
  };
  const call = BUSINESS.phones[0];
  return (
    <div className="mt-4 text-left">
      <h4 className="flex items-center gap-2 text-sm font-medium">
        <BellRing aria-hidden className="h-4 w-4 text-bronze" />{" "}
        {back ? `Remind me when ${back} is back` : `Waitlist for ${label}`}
      </h4>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {back
          ? `${back} is back on ${label}. Get a notification on this device the evening before, with the first free time. A place isn’t reserved.`
          : `Get a notification on this device if a time opens for your services${staffId ? " with your selected stylist" : ""}. A place isn’t reserved.`}
      </p>
      {rescheduling ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Your current appointment stays unchanged.
        </p>
      ) : null}
      {state === "on" || state === "cancelling" ? (
        <>
          <div
            role="status"
            aria-live="polite"
            className="mt-3 rounded-md border border-border bg-muted/40 p-3 text-sm"
          >
            <p className="flex items-center gap-2 font-medium text-foreground">
              <Check aria-hidden className="h-4 w-4 shrink-0 text-bronze" />{" "}
              {back ? `We’ll remind you before ${label}` : `You’re on the waitlist for ${label}`}
            </p>
            <p className="mt-1 text-muted-foreground">
              {confirmed === false
                ? "Your place is saved, but the confirmation alert couldn’t be sent. We’ll retry opening alerts on this device."
                : confirmed === true
                  ? "Your place is saved and the confirmation alert was sent. Delivery depends on this device’s notification settings."
                  : "Your waitlist request is saved on this device. We’ll notify you if a matching time opens."}
            </p>
          </div>
          <Button
            variant="outline"
            className="mt-3 min-h-11"
            disabled={state === "cancelling"}
            onClick={() => void cancel()}
          >
            <X aria-hidden className="h-4 w-4" />
            {state === "cancelling" ? "Removing…" : back ? "Cancel reminder" : "Cancel waitlist"}
          </Button>
        </>
      ) : state === "blocked" || state === "unsupported" ? (
        <>
          <p role="status" className="mt-3 text-sm text-muted-foreground">
            {state === "blocked"
              ? "Notifications are off. Allow them in your browser settings, then reload to join the waitlist."
              : "This browser doesn’t support appointment notifications. Call the salon to ask about cancellations."}
          </p>
          {call ? (
            <Button asChild variant="outline" className="mt-3">
              <a href={`tel:${call}`}>
                <Phone aria-hidden className="h-4 w-4" /> Call the salon
              </a>
            </Button>
          ) : null}
        </>
      ) : (
        <>
          {state === "removed" ? (
            <div role="status" aria-live="polite" className="mt-3 text-sm">
              <p className="flex items-center gap-2 font-medium">
                <Check aria-hidden className="h-4 w-4 shrink-0 text-bronze" />
                Waitlist entry removed for {label}
              </p>
              <p className="mt-1 text-muted-foreground">
                You won’t receive new opening alerts for this request. Other waitlist entries
                {rescheduling ? " and your current appointment" : ""} stay unchanged. An alert
                already sent may still arrive.
              </p>
            </div>
          ) : null}
          <Button
            variant="outline"
            className="mt-3 min-h-11"
            disabled={state === "busy" || state === "checking"}
            onClick={() => void join()}
          >
            <BellRing aria-hidden className="h-4 w-4" />
            {state === "busy"
              ? "Joining…"
              : state === "checking"
                ? "Checking notifications…"
                : back
                  ? "Remind me"
                  : "Join waitlist"}
          </Button>
        </>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
