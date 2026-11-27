import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { z } from "zod";
import { useBooking } from "@/lib/booking-store";

// From a "a time just opened" notification: set up the booking (services,
// day, stylist) and go straight to choosing the time.
export const Route = createFileRoute("/open-time")({
  validateSearch: (s) =>
    z
      .object({
        d: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .catch(""),
        a: z.enum(["men", "women"]).catch("men"),
        s: z.string().max(400).catch(""),
        st: z.string().uuid().optional().catch(undefined),
      })
      .parse(s),
  head: () => ({
    meta: [
      { name: "description", content: "Book a newly available appointment at Lumen Studio." },
      { property: "og:title", content: "A time opened up \u2014 Lumen Studio" },
      {
        property: "og:description",
        content: "Book a newly available appointment at Lumen Studio.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: "A time opened up — Lumen Studio" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OpenTime,
});

function OpenTime() {
  const { d, a, s, st } = Route.useSearch();
  const { hydrated, update } = useBooking();
  const navigate = useNavigate();
  const done = useRef(false);
  useEffect(() => {
    if (!hydrated || done.current) return;
    done.current = true;
    const ids = s.split(",").filter(Boolean);
    if (!d || !ids.length) {
      void navigate({ to: "/book", replace: true });
      return;
    }
    update({
      audience: a,
      serviceIds: ids,
      date: d,
      time: null,
      staffId: st ?? null,
      timeStale: false,
    });
    void navigate({ to: "/time", replace: true });
  }, [hydrated, d, a, s, st, update, navigate]);
  return <div className="min-h-[100svh] bg-background" />;
}
