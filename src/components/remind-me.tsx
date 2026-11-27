// "Remind me on this phone": free phone reminders for the guest's own booking
// (a day before and 2 hours before), sent by the salon's site through the
// phone's own push service. Where a browser can't do it (iPhone outside a
// Home Screen app), the button stays hidden: Add to calendar covers that.
import { useEffect, useState } from "react";
import { BellRing, Check, Loader2 } from "lucide-react";
import { auth, type Booking } from "@/lib/booking-store";
import { pushPublicKey, remindMeOnPhone } from "@/lib/salon.functions";
import { haptic, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const KEY = (ref: string) => `bk.remind.${ref}`;

const keyBytes = (b64: string) => {
  const t = b64.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "===".slice((t.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

export function RemindMe({
  booking,
  className,
  tone = "light",
  prompt = false,
}: {
  booking: Booking;
  className?: string;
  tone?: "light" | "dark";
  prompt?: boolean;
}) {
  const [state, setState] = useState<"hidden" | "off" | "busy" | "on" | "blocked">("hidden");
  const [error, setError] = useState("");
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const ok = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (!ok) return setState("hidden");
    if (Notification.permission === "denied") return setState("blocked");
    let on = false;
    try {
      on = localStorage.getItem(KEY(booking.reference)) === "1";
    } catch {
      /* ignore */
    }
    setState(on && Notification.permission === "granted" ? "on" : "off");
  }, [booking.reference]);

  if (booking.status === "cancelled" || dismissed || (state === "hidden" && !prompt)) return null;

  const turnOn = async () => {
    setError("");
    setState("busy");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setState(perm === "denied" ? "blocked" : "off");
      const reg = await navigator.serviceWorker.register("/admin-sw.js");
      await navigator.serviceWorker.ready;
      const { publicKey } = await pushPublicKey();
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(publicKey) as BufferSource,
        }));
      const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      const r = await remindMeOnPhone({
        data: {
          reference: booking.reference,
          ...auth(booking),
          endpoint: j.endpoint,
          p256dh: j.keys.p256dh,
          auth: j.keys.auth,
          origin: location.origin,
        },
      });
      if (!r.ok) {
        setError(r.error);
        return setState("off");
      }
      try {
        localStorage.setItem(KEY(booking.reference), "1");
      } catch {
        /* ignore */
      }
      haptic();
      setState("on");
    } catch {
      setError("Couldn't turn reminders on here. Add it to your calendar instead.");
      setState("off");
    }
  };

  const dark = tone === "dark";
  return (
    <div className={className}>
      {prompt && state !== "on" && state !== "blocked" && state !== "hidden" ? (
        <div className={cn("mb-3", dark ? "text-[#DAE5E1]" : "text-foreground")}>
          <p className="font-display text-xl">Your booking is confirmed. Turn on alerts?</p>
          <p className={cn("mt-1 text-sm", dark ? "text-[#DAE5E1]/65" : "text-muted-foreground")}>
            Get reminders and updates if the salon changes your time, stylist or price. After your
            visit, we’ll invite you to rate the service. Alerts are optional; your booking stays
            confirmed either way.
          </p>
        </div>
      ) : null}
      {state === "on" ? (
        <p
          className={cn(
            "flex items-center gap-2 text-[0.85rem]",
            dark ? "text-[#DAE5E1]/80" : "text-muted-foreground",
          )}
        >
          <Check
            className={cn("h-4 w-4", dark ? "text-[#DAE5E1]" : "text-foreground")}
            strokeWidth={2}
          />{" "}
          Booking alerts are enabled on this phone, including reminders and appointment updates.
        </p>
      ) : state === "blocked" ? (
        <p className={cn("text-[0.82rem]", dark ? "text-[#DAE5E1]/65" : "text-muted-foreground")}>
          Notifications are blocked for this site, so we can't remind you here. Add it to your
          calendar instead.
        </p>
      ) : state === "hidden" ? (
        <p className={cn("text-sm", dark ? "text-[#DAE5E1]/65" : "text-muted-foreground")}>
          This browser cannot receive phone alerts. On iPhone, add the site to your Home Screen
          first, or add your appointment to your calendar.
        </p>
      ) : (
        <Button
          variant="outline"
          type="button"
          onClick={() => void turnOn()}
          disabled={state === "busy"}
          className={cn(
            "press flex min-h-12 w-full items-center justify-center gap-2.5 rounded-sm border px-5 text-[0.72rem] uppercase tracking-[0.2em] disabled:opacity-60",
            dark
              ? "border-[#DAE5E1]/28 bg-transparent text-[#DAE5E1] hover:border-[#DAE5E1]/55 hover:bg-white/5 hover:text-[#DAE5E1]"
              : "border-foreground/20 hover:border-foreground/45",
          )}
        >
          {state === "busy" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <BellRing className="h-4 w-4" strokeWidth={1.5} />
          )}
          Enable appointment alerts
        </Button>
      )}
      {prompt && state !== "on" && state !== "busy" && state !== "blocked" && state !== "hidden" ? (
        <Button
          variant="ghost"
          size="sm"
          className={cn("mt-2", dark && "text-[#DAE5E1]/75 hover:bg-white/5 hover:text-[#DAE5E1]")}
          onClick={() => setDismissed(true)}
        >
          Not now
        </Button>
      ) : null}
      {error ? <p className="mt-2 text-[0.8rem] text-destructive">{error}</p> : null}
    </div>
  );
}
