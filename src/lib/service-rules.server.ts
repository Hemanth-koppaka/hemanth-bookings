// Resolves each service's stylist rule from the salon's settings
// ("service_rules": { [serviceId]: { mode, stylist } }) and the staff store.
// Defaults: Kiran's Signature is only with Kiran (closed while he's away);
// everything else is "any".
// The fallback pool = other active stylists who already offer a service in the
// same category of the same gender's menu (the hairstylists for that menu).
import { supabaseAdmin as sb } from "@/integrations/supabase/client.server";
import { MEN_MENU, WOMEN_MENU } from "./salon";
import { SIGNATURE_RE, type ServiceRule, type ServiceRuleSetting } from "./service-rules";
import type { loadStore } from "./staff-store.server";

type Store = Awaited<ReturnType<typeof loadStore>>;
type Row = Record<string, unknown>;

export async function loadRuleSettings(): Promise<Record<string, ServiceRuleSetting>> {
  const { cachedSetting } = await import("./settings-cache.server");
  return cachedSetting("service_rules", async () => {
    const { data } = await sb
      .from("site_settings")
      .select("value")
      .eq("key", "service_rules")
      .maybeSingle();
    return ((data?.value ?? {}) as Record<string, ServiceRuleSetting>) || {};
  });
}

type Menu = { services: { id: string; name: string }[] }[];

/** `menus` defaults to the salon's live menus (already applied on the server). */
export function resolveRules(
  store: Store,
  settings: Record<string, ServiceRuleSetting>,
  menus: Menu[] = [MEN_MENU, WOMEN_MENU],
): Record<string, ServiceRule> {
  const staff = (store.staff as Row[])
    .filter((r) => r["active"] !== false && !r["archived_at"])
    .sort((a, b) => ((a["display_order"] as number) ?? 0) - ((b["display_order"] as number) ?? 0));
  const byId = new Map(staff.map((r) => [r["id"] as string, r]));
  const kiran = staff.find((r) => /^kiran\b/i.test(String(r["name"] ?? "")));
  const offers = new Map<string, Set<string>>();
  for (const r of store.staff_services as Row[]) {
    const k = r["staff_id"] as string;
    if (!offers.has(k)) offers.set(k, new Set());
    offers.get(k)!.add(r["service_id"] as string);
  }
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10); // salon date (IST)
  const out: Record<string, ServiceRule> = {};
  for (const menu of menus)
    for (const cat of menu)
      for (const svc of cat.services) {
        const set = settings[svc.id];
        const only = set ? set.mode === "only" : SIGNATURE_RE.test(svc.name);
        const preferredId =
          set?.mode === "preferred" || set?.mode === "only"
            ? set.stylist
            : set?.mode === "any"
              ? null
              : SIGNATURE_RE.test(svc.name)
                ? ((kiran?.["id"] as string) ?? null)
                : null;
        const preferred = preferredId ? byId.get(preferredId) : undefined;
        if (only && preferredId) {
          // only this stylist: no stand-in, closed on their leave days and while
          // they aren't taking bookings (inactive or not bookable)
          const row = (store.staff as Row[]).find((r) => r["id"] === preferredId);
          out[svc.id] = {
            preferred: preferredId,
            preferredName: String(row?.["name"] ?? "Kiran"),
            fallback: [],
            only: true,
            ...(!preferred || preferred["bookable"] === false ? { off: true } : {}),
            away: (store.staff_leave as Row[])
              .filter(
                (r) =>
                  r["staff_id"] === preferredId &&
                  !r["archived_at"] &&
                  String(r["end_date"] ?? "") >= today,
              )
              .map((r) => ({ start: String(r["start_date"]), end: String(r["end_date"]) }))
              .sort((a, b) => a.start.localeCompare(b.start)),
          };
          continue;
        }
        if (!preferred) continue; // no (valid) preferred stylist: normal multi-stylist rules
        const siblings = cat.services.filter((x) => x.id !== svc.id).map((x) => x.id);
        const fallback = staff
          .filter((r) => r["id"] !== preferredId && r["bookable"] !== false)
          .filter((r) => siblings.some((id) => offers.get(r["id"] as string)?.has(id)))
          .map((r) => r["id"] as string);
        out[svc.id] = {
          preferred: preferredId!,
          preferredName: String(preferred["name"] ?? ""),
          fallback,
        };
      }
  return out;
}
