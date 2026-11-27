import { z } from "zod";
import type { Category } from "./salon";

export const lookInput = z.object({
  audience: z.enum(["men", "women"]),
  description: z.string().trim().min(5).max(600),
});
export const lookOutput = z.object({
  summary: z.string().max(500),
  recommendations: z.array(z.object({ serviceId: z.string(), reason: z.string().max(350) })).max(5),
});

/** Model output never supplies a bookable service or price: resolve against the live selected menu. */
export function resolveRecommendations(output: z.infer<typeof lookOutput>, menu: Category[]) {
  const services = new Map(menu.flatMap((c) => c.services).map((s) => [s.id, s]));
  const seen = new Set<string>();
  return output.recommendations.flatMap((r) => {
    const service = services.get(r.serviceId);
    if (!service || seen.has(service.id)) return [];
    seen.add(service.id);
    return [{ id: service.id, name: service.name, price: service.price, minutes: service.minutes, from: Boolean(service.from), reason: r.reason }];
  });
}