import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/waitlist-dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authenticateCronRequest } = await import("@/integrations/supabase/cron-auth");
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        const { dispatchWaitlist } = await import("@/lib/waitlist.server");
        const { dispatchDue } = await import("@/lib/notify/service.server");
        const [waitlist, appointments] = await Promise.all([dispatchWaitlist(), dispatchDue()]);
        return Response.json({waitlist, appointments});
      },
    },
  },
});