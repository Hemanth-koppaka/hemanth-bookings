import { z } from "zod";
/** One chat message (the assistant is rule-based; this is all it reads). */
type ResponsesInputItem = { role?: string; content?: unknown; [key: string]: unknown };
import { assertAdmin } from "./admin-auth.server";
import { assistantTools } from "./admin-assistant-tools.server";
import {
  explicitDecision,
  safeAssistantArguments,
  type AssistantProposal,
  type AssistantReply,
} from "./admin-assistant-policy";

export async function ownerHash(pin: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pin));
  return Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, "0")).join("");
}
/** Same data regardless of object key order (jsonb stores keys in its own order). */
function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .map((k) => [k, stable((v as Record<string, unknown>)[k])]),
    );
  return v === undefined ? null : v;
}
export function sameData(a: unknown, b: unknown): boolean {
  return (
    JSON.stringify(stable(JSON.parse(JSON.stringify(a ?? null)))) ===
    JSON.stringify(stable(b ?? null))
  );
}
const object = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
/** (kept for the voice relay's tool descriptions) */
export function modelSchema(schema: z.ZodType) {
  const json = z.toJSONSchema(schema, { unrepresentable: "any" });
  if (json.properties) delete json.properties["pin"];
  if (json.required) json.required = json.required.filter((key) => key !== "pin");
  return json;
}
function details(args: unknown, prefix = ""): string[] {
  return Object.entries(object(args)).flatMap(([key, value]) => {
    if (key === "pin") return [];
    const name = (prefix + key).replace(/([a-z])([A-Z])/g, "$1 $2");
    if (value && typeof value === "object" && !Array.isArray(value))
      return details(value, name + " · ");
    if (typeof value === "number" && /^(time|start|end|startMinute|endMinute)$/.test(key))
      return [
        `${name}: ${Math.floor(value / 60) % 12 || 12}:${String(value % 60).padStart(2, "0")} ${value >= 720 ? "PM" : "AM"}`,
      ];
    return [`${name}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`];
  });
}
export function proposal(row: Record<string, unknown>): AssistantProposal {
  return {
    id: String(row["id"]),
    summary: String(row["summary"]),
    status: String(row["status"]),
    details: details(row["arguments"]),
  };
}
export async function pending(pin: string, conversationId: string) {
  const sb = await assertAdmin(pin);
  const { data, error } = await sb
    .from("admin_assistant_operations")
    .select("*")
    .eq("owner_hash", await ownerHash(pin))
    .eq("conversation_id", conversationId)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw new Error("Could not read the pending change.");
  return data;
}
export async function baseline(
  pin: string,
  action: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const tools = assistantTools();
  const read = async (name: string, input = {}) =>
    tools.find((t) => t.name === name)?.execute(pin, input);
  if (action === "adminUpsertBooking" && args["patch"])
    return read("adminBooking", { reference: args["reference"] });
  if (["adminSaveCustomer"].includes(action)) return read("adminCustomer", { id: args["id"] });
  if (
    [
      "adminSaveService",
      "adminSaveCategory",
      "adminArchiveItem",
      "adminReorder",
      "adminDuplicateService",
    ].includes(action)
  )
    return read("adminCatalogue");
  if (
    ["adminSaveStaff", "adminAddLeave", "adminAddStaffBlock", "adminRemoveStaffTime"].includes(
      action,
    )
  )
    return read("adminStaffList");
  if (["adminSaveRules", "adminSaveConfig"].includes(action)) return read("adminGetRules");
  if (action === "adminSaveNotifySettings") return read("adminNotifySettings");
  if (["adminPublishSite", "adminSaveSiteDraft", "adminDiscardSiteDraft"].includes(action))
    return read("adminGetSite");
  if (
    [
      "adminSaveBusinessHours",
      "adminSaveHours",
      "adminSaveException",
      "adminSaveBusiness",
    ].includes(action)
  )
    return read("adminGetContent");
  if (action === "adminReopen") return read("adminClosures");
  return null;
}
export async function ensureNoClashes(pin: string, action: string, args: Record<string, unknown>) {
  if (
    !["adminSaveBlock", "adminAddStaffBlock", "adminAddLeave", "adminAddClosure"].includes(action)
  )
    return;
  const sb = await assertAdmin(pin);
  const dates = Array.isArray(args["dates"])
    ? args["dates"].filter((d): d is string => typeof d === "string")
    : [];
  const from = String(args["date"] ?? args["start"] ?? dates[0] ?? "");
  const to = String(
    args["end"] && typeof args["end"] === "string" ? args["end"] : (dates.at(-1) ?? from),
  );
  if (!from) throw new Error("Choose an exact date first.");
  const { data, error } = await sb
    .from("bookings")
    .select("*")
    .gte("date", from)
    .lte("date", to)
    .neq("status", "cancelled");
  if (error) throw new Error("Could not check existing appointments.");
  const { staffIdOf } = await import("./staff-store.server");
  const start =
    typeof args["start"] === "number"
      ? args["start"]
      : typeof args["startMinute"] === "number"
        ? args["startMinute"]
        : 0;
  const end =
    typeof args["end"] === "number"
      ? args["end"]
      : typeof args["endMinute"] === "number"
        ? args["endMinute"]
        : 1440;
  const hit = (data ?? [])
    .filter(
      (b) =>
        !["completed", "no-show", "cancelled"].includes(String(object(b.meta)["status"] ?? "")),
    )
    .filter((b) => !dates.length || dates.includes(b.date))
    .filter((b) => !args["staffId"] || staffIdOf(b) === args["staffId"])
    .filter((b) => b.time < end && start < (b.ends_at_minute ?? b.time + b.slots * 30));
  if (hit.length)
    throw new Error(
      `This overlaps ${hit.length} existing appointment(s): ${hit.map((b) => b.reference).join(", ")}. They will stay unchanged; choose another time.`,
    );
}

export async function decideAssistantOperation(
  pin: string,
  id: string,
  decision: "confirm" | "cancel",
): Promise<AssistantReply> {
  const sb = await assertAdmin(pin);
  const owner = await ownerHash(pin);
  const { data: current, error } = await sb
    .from("admin_assistant_operations")
    .select("*")
    .eq("id", id)
    .eq("owner_hash", owner)
    .maybeSingle();
  if (error || !current) throw new Error("That change does not belong to this session.");
  if (current.status !== "pending")
    return {
      text:
        current.status === "succeeded"
          ? "This change was already saved. It has not been repeated."
          : `This change is ${current.status}; it cannot be submitted again.`,
    };
  if (decision === "cancel") {
    const { data: cancelled, error: cancelError } = await sb
      .from("admin_assistant_operations")
      .update({ status: "cancelled", finished_at: new Date().toISOString() })
      .eq("id", id)
      .eq("owner_hash", owner)
      .eq("status", "pending")
      .select("id");
    if (cancelError) throw new Error("Could not cancel this proposal.");
    return {
      text: cancelled?.length
        ? "Cancelled. No changes were made."
        : "This change is already being processed; check its outcome before trying again.",
    };
  }
  if (new Date(current.expires_at).getTime() <= Date.now())
    throw new Error("This confirmation expired. Ask again to check the latest details.");
  const tool = assistantTools().find((t) => t.name === current.action && !t.read);
  if (!tool) throw new Error("That action is not permitted.");
  const args = safeAssistantArguments(current.arguments);
  await ensureNoClashes(pin, current.action, args);
  const fresh = await baseline(pin, current.action, args);
  // compare content, not text: the database (jsonb) reorders object keys when it stores the snapshot
  if (sameData(fresh, current.before_state) === false)
    throw new Error("The details changed since this preview. Ask again before saving.");
  const { data: claimed, error: claimError } = await sb
    .from("admin_assistant_operations")
    .update({ status: "executing" })
    .eq("id", id)
    .eq("owner_hash", owner)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .select("id");
  if (claimError || !claimed?.length)
    return { text: "This change is already being processed. It will not be repeated." };
  try {
    const result = await tool.execute(pin, args);
    const r = object(result);
    if (r["ok"] === false || ["failed", "skipped"].includes(String(r["status"] ?? ""))) {
      await sb
        .from("admin_assistant_operations")
        .update({
          status: "failed",
          result: JSON.parse(JSON.stringify(result)),
          finished_at: new Date().toISOString(),
        })
        .eq("id", id);
      return {
        text: String(
          r["error"] ??
            r["detail"] ??
            (r["clashes"]
              ? "Existing appointments overlap this time. Nothing was moved; choose another time."
              : "The change could not be saved."),
        ),
      };
    }
    const verified = await baseline(pin, current.action, args);
    const { error: finishError } = await sb
      .from("admin_assistant_operations")
      .update({
        status: "succeeded",
        result: JSON.parse(JSON.stringify({ result, verified })),
        finished_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (finishError)
      return {
        text: "The action returned successfully, but its confirmation could not be recorded. Check the admin page before retrying.",
      };
    return {
      text: `Saved. ${current.summary}${r["reference"] ? ` Reference: ${r["reference"]}.` : ""}`,
    };
  } catch (error) {
    await sb
      .from("admin_assistant_operations")
      .update({ status: "unknown", finished_at: new Date().toISOString() })
      .eq("id", id);
    return {
      text: `The outcome needs checking before another attempt. ${error instanceof Error ? error.message : "Please check the relevant admin page."}`,
    };
  }
}

export async function runAssistant(
  pin: string,
  conversationId: string,
  messages: ResponsesInputItem[],
  _options: {
    signal?: AbortSignal;
    runId?: string;
    metadata?: Record<string, string>;
    consumeInput?: () => void;
    context?: unknown;
  } = {},
): Promise<AssistantReply> {
  const sb = await assertAdmin(pin);
  const latest = messages.filter((m) => "role" in m && m.role === "user").at(-1);
  const userText =
    latest && "content" in latest && typeof latest.content === "string" ? latest.content : "";
  const waiting = await pending(pin, conversationId);
  const decision = explicitDecision(userText);
  // Only exact user utterances or the separate confirmation endpoint authorize writes.
  if (waiting && decision) return decideAssistantOperation(pin, waiting.id, decision);
  if (!waiting && decision)
    return {
      text:
        decision === "confirm"
          ? "There's nothing waiting to confirm right now. Tell me what to do, e.g. “block 3 pm to 5 pm today”."
          : "Okay, nothing to cancel.",
    };
  if (waiting && userText.trim())
    await sb
      .from("admin_assistant_operations")
      .update({ status: "cancelled" })
      .eq("id", waiting.id)
      .eq("status", "pending");
  const { planReply } = await import("./admin-assistant-planner.server");
  return planReply(pin, conversationId, userText, _options.context);
}

export function assistantError(error: unknown): string {
  return error instanceof Error ? error.message : "The request could not finish.";
}
