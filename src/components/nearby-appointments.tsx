import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { getAvailability } from "@/lib/salon.functions";
import { nearbyOpenDates } from "@/lib/calendar-options";
import { fromISO, minuteLabel } from "@/lib/salon";
import { WaitlistOption } from "@/components/waitlist-option";

type Props = {
  days: { iso: string; selectable: boolean }[];
  date: string;
  audience: string;
  serviceIds: string[];
  staffId?: string | null | undefined;
  reference?: string;
  proof?: { token?: string; phone?: string };
  onPick: (date: string, time: number) => void;
};

export function NearbyAppointments({ days, date, audience, serviceIds, staffId, reference, proof, onPick }: Props) {
  const [results, setResults] = useState<{ date: string; time: number }[]>([]);
  const [state, setState] = useState<"loading" | "done" | "error">("loading");
  const servicesKey = serviceIds.join(",");
  const token = proof?.token;
  const phone = proof?.phone;
  const daysKey = days.map((d) => `${d.iso}:${d.selectable}`).join(",");
  useEffect(() => {
    let active = true;
    setResults([]);
    setState("loading");
    void (async () => {
      const found: { date: string; time: number }[] = [];
      try {
        for (const candidate of nearbyOpenDates(days, date).slice(0, 14)) {
          if (!active) return;
          const day = await getAvailability({ data: { date: candidate.iso, audience, serviceIds: servicesKey.split(","), ...(reference ? { reference } : {}), ...(token ? { token } : {}), ...(phone ? { phone } : {}) } });
          if (!active) return;
          const who = staffId ?? day.preferred?.id;
          const slot = !day.closed && !day.message ? day.slots.find((s) => s.available && (!who || !s.staff || s.staff.includes(who))) : undefined;
          if (slot) {
            found.push({ date: candidate.iso, time: slot.minute });
            setResults([...found]);
          }
          if (found.length === 3) break;
        }
        if (active) setState("done");
      } catch { if (active) setState("error"); }
    })();
    return () => { active = false; };
  }, [daysKey, date, audience, servicesKey, staffId, reference, token, phone]);

  return <section className="mt-6 border-t border-hairline pt-4" aria-label="Nearby available appointments" aria-busy={state === "loading"}>
    <h3 className="text-sm font-medium">Nearby available dates</h3>
    <div className="mt-3 flex flex-wrap gap-2">
      {results.map((r) => <Button key={r.date} variant="outline" className="h-auto min-h-12 flex-col gap-1 whitespace-normal px-4 py-2" onClick={() => onPick(r.date, r.time)}>
        <span>{fromISO(r.date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</span>
        <span className="text-xs text-muted-foreground">{minuteLabel(r.time)}</span>
      </Button>)}
    </div>
    <p role="status" className="mt-2 text-xs text-muted-foreground">
      {state === "loading" ? "Checking nearby dates…" : state === "error" ? "Couldn’t check more dates. Please try another date." : !results.length ? "No free times on nearby dates. Join the waitlist for your chosen day, or choose a later date." : ""}
    </p>
    {state === "done" && !results.length ? <WaitlistOption key={`${date}.${audience}.${servicesKey}.${staffId ?? "any"}`} date={date} audience={audience} serviceIds={serviceIds} staffId={staffId} rescheduling={Boolean(reference)} /> : null}
  </section>;
}