import { z } from "zod";

export const assistantMessageInput = z.object({
  pin: z.string().min(1).max(512),
  conversationId: z.string().uuid(),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(12000) }))
    .min(1)
    .max(60),
  /** short-lived context of the open assistant window (last stylist, date, numbered results); hints only, re-checked on the server */
  context: z
    .unknown()
    .optional()
    .refine((v) => v === undefined || JSON.stringify(v).length < 20000, "Context too large"),
});
export const assistantDecisionInput = z.object({
  pin: z.string().min(1).max(512),
  id: z.string().uuid(),
  decision: z.enum(["confirm", "cancel"]),
});
export type AssistantProposal = { id: string; summary: string; details: string[]; status: string };
/** Plain JSON (the assistant's in-memory context travels as data only). */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
/** A link to an existing admin page (never a write). */
export type AssistantAction = {
  label: string;
  to: AdminRoute;
  search?: { date?: string; id?: string };
};
export const ADMIN_ROUTES = [
  "/admin",
  "/admin/calendar",
  "/admin/appointments",
  "/admin/customers",
  "/admin/services",
  "/admin/reports",
  "/admin/activity",
  "/admin/closures",
  "/admin/staff",
  "/admin/rules",
  "/admin/settings",
  "/admin/notifications",
  "/admin/content",
  "/admin/system",
] as const;
export type AdminRoute = (typeof ADMIN_ROUTES)[number];
/** How an answer is shown: a list, a day timeline, or summary figures with a small bar chart. */
export type AssistantView =
  | {
      type: "list";
      title: string;
      rows: { primary: string; secondary?: string; meta?: string; tag?: string; muted?: boolean }[];
    }
  | {
      type: "timeline";
      title: string;
      rows: {
        date?: string;
        time: string;
        customer: string;
        service: string;
        stylist?: string;
        status: string;
      }[];
    }
  | {
      type: "stats";
      title: string;
      stats: { label: string; value: string }[];
      bars?: { label: string; value: number; text: string }[];
    };
export type AssistantReply = {
  text: string;
  proposal?: AssistantProposal;
  download?: { filename: string; csv: string };
  context?: Json;
  undo?: boolean;
  view?: AssistantView;
  actions?: AssistantAction[];
  navigate?: AssistantAction;
};
export function explicitDecision(text: string): "confirm" | "cancel" | null {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[.!?,]/g, "")
    .replace(/\s+/g, " ");
  if (
    /^(yes|yeah|yep|yup|ok|okay|sure|confirm|confirmed|confirm it|yes confirm|yes confirm it|yes please|yes go ahead|go ahead|do it|yes do it|save it|yes save it|haan|haa|ha ji|haan ji|avunu|sare)$/.test(
      normalized,
    )
  )
    return "confirm";
  if (
    /^(no|nope|nah|cancel|no cancel|cancel it|no don't|no dont|do not save|don't save|dont save|leave it|stop|nahi|nahin|vaddu|ledu)$/.test(
      normalized,
    )
  )
    return "cancel";
  return null;
}
export function safeAssistantArguments(value: unknown): Record<string, unknown> {
  const parsed = z.record(z.string(), z.unknown()).parse(value);
  const check = (item: unknown): void => {
    if (!item || typeof item !== "object") return;
    for (const [key, child] of Object.entries(item)) {
      if (
        /^(pin|token|apiKey|password|code|secret|__proto__|constructor|prototype|booking_no|reference_new)$/i.test(
          key,
        )
      )
        throw new Error("Credentials and booking identifiers cannot be changed by the assistant.");
      check(child);
    }
  };
  check(parsed);
  // A clash override is never granted by model output.
  if (parsed["confirm"] === true)
    throw new Error("Existing appointments must be preserved; choose another time.");
  return parsed;
}
