// Operational building blocks for the admin console: global search, the
// booking drawer (every action a booking can need), and the dialogs for new
// bookings / walk-ins, blocking time and closing a day. All writes go through
// the server, which re-checks availability, so the console can't create a
// clash even by accident.
import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  CalendarClock,
  Check,
  Copy,
  Loader2,
  MessageCircle,
  Phone,
  Search,
  UserPlus,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdmin, STATUS_LABEL, type ApptStatus } from "@/lib/admin-store";
import {
  BUSINESS,
  formatDuration,
  fromISO,
  inr,
  menuFor,
  minuteLabel,
  toISO,
  type Audience,
} from "@/lib/salon";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  adminAvailability,
  adminBooking,
  adminBookings,
  adminCustomers,
  adminDay,
  type AdminBooking,
  type AdminCustomer,
} from "@/lib/admin-data.functions";
import { adminUpsertBooking } from "@/lib/salon.functions";
import { adminArchiveBlock, adminSaveBlock } from "@/lib/admin-ops.functions";
import {
  adminAddClosure,
  adminAddStaffBlock,
  adminRemoveStaffTime,
} from "@/lib/admin-staff.functions";
import { adminSaveException } from "@/lib/admin-content.functions";
import type { Slot } from "@/lib/availability";
import { adminReferencePhotos } from "@/lib/photos.functions";
import { adminNotificationLogs, type NotifyLog } from "@/lib/admin-notify.functions";
import { messageText, type BookingFacts, type NotifyEvent } from "@/lib/notify/messages";
import { waLink as whatsapp } from "@/lib/whatsapp-link";
import { StaffAvatar } from "@/components/staff-avatar";

/* ── small shared bits ─────────────────────────────────────── */

export const dateLabel = (
  iso: string,
  opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" },
) => fromISO(iso).toLocaleDateString("en-GB", opts);

export const salonToday = () =>
  toISO(new Date(Date.now() + (new Date().getTimezoneOffset() + 330) * 60_000));

const digits = (p: string) => p.replace(/\D/g, "").slice(-10);
export const waLink = (phone: string) => `https://wa.me/91${digits(phone)}`;

/** Runs a server read for the admin, with loading/error state and a reload(). */
// Pages the admin already opened show their last data straight away and refresh
// quietly underneath (no blank "loading" each time you switch screens).
const adminCache = new Map<string, unknown>();

export function useAdminData<T>(load: (pin: string) => Promise<T>, deps: unknown[]) {
  const { pin, signOut } = useAdmin();
  const key = `${pin.slice(-12)}|${load.toString()}|${JSON.stringify(deps)}`;
  const [data, setData] = useState<T | null>(() => (adminCache.get(key) as T | undefined) ?? null);
  const [loading, setLoading] = useState(() => !adminCache.has(key));
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    const hit = adminCache.get(key) as T | undefined;
    if (hit !== undefined) setData(hit);
    setLoading(hit === undefined);
    load(pin)
      .then((d) => {
        if (!live) return;
        adminCache.set(key, d);
        setData(d);
        setError("");
      })
      .catch((e: unknown) => {
        if (!live) return;
        const msg = e instanceof Error ? e.message : "";
        if (/session/i.test(msg)) return signOut("Your session ended. Please sign in again.");
        setError("Couldn't load. Check your connection and try again.");
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, tick, key]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, reload };
}

export function LoadState({
  loading,
  error,
  onRetry,
}: {
  loading: boolean;
  error: string;
  onRetry: () => void;
}) {
  if (error)
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/25 bg-destructive/[0.04] px-4 py-3 text-[0.85rem] text-destructive">
        {error}
        <button onClick={onRetry} className="press underline underline-offset-4">
          Retry
        </button>
      </div>
    );
  if (loading)
    return (
      <div className="h-1 overflow-hidden rounded bg-foreground/5">
        <div className="h-full w-1/3 animate-pulse bg-bronze/40" />
      </div>
    );
  return null;
}

/* ── global search ─────────────────────────────────────────── */

export function GlobalSearch({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { pin } = useAdmin();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ bookings: AdminBooking[]; customers: AdminCustomer[] }>({
    bookings: [],
    customers: [],
  });
  const [drawer, setDrawer] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) {
      setResults({ bookings: [], customers: [] });
      return;
    }
    setBusy(true);
    const t = window.setTimeout(() => {
      Promise.all([
        adminBookings({ data: { pin, q: term, page: 0 } }).catch(() => ({
          bookings: [] as AdminBooking[],
        })),
        adminCustomers({ data: { pin, q: term, page: 0 } }).catch(() => ({
          customers: [] as AdminCustomer[],
        })),
      ])
        .then(([b, c]) =>
          setResults({ bookings: b.bookings.slice(0, 8), customers: c.customers.slice(0, 6) }),
        )
        .finally(() => setBusy(false));
    }, 250);
    return () => window.clearTimeout(t);
  }, [q, open, pin]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="top-[12%] max-w-xl translate-y-0 gap-0 p-0">
          <DialogHeader className="sr-only">
            <DialogTitle>Search</DialogTitle>
            <DialogDescription>
              Customers, bookings, phone numbers and booking IDs
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-3 border-b border-hairline px-4">
            <Search className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Name, phone, booking ID or service…"
              className="h-12 flex-1 bg-transparent text-[0.95rem] outline-none"
            />
            {busy ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-2">
            {q.trim().length < 2 ? (
              <p className="px-3 py-6 text-center text-[0.85rem] text-muted-foreground">
                Type at least two characters.
              </p>
            ) : !busy && !results.bookings.length && !results.customers.length ? (
              <p className="px-3 py-6 text-center text-[0.85rem] text-muted-foreground">
                Nothing found.
              </p>
            ) : null}
            {results.customers.length ? (
              <div className="px-3 pt-2 pb-1 text-[0.6rem] uppercase tracking-[0.2em] text-muted-foreground">
                Customers
              </div>
            ) : null}
            {results.customers.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  onOpenChange(false);
                  void navigate({ to: "/admin/customers", search: { id: c.id } as never });
                }}
                className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left hover:bg-foreground/[0.04]"
              >
                <span className="truncate text-[0.9rem]">{c.name}</span>
                <span className="shrink-0 text-[0.78rem] tabular-nums text-muted-foreground">
                  {c.phone}
                </span>
              </button>
            ))}
            {results.bookings.length ? (
              <div className="px-3 pt-3 pb-1 text-[0.6rem] uppercase tracking-[0.2em] text-muted-foreground">
                Bookings
              </div>
            ) : null}
            {results.bookings.map((b) => (
              <button
                key={b.reference}
                onClick={() => {
                  onOpenChange(false);
                  setDrawer(b.reference);
                }}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-foreground/[0.04]"
              >
                <span className="w-24 shrink-0 text-[0.78rem] tabular-nums text-muted-foreground">
                  {dateLabel(b.date, { day: "numeric", month: "short" })} · {minuteLabel(b.time)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[0.9rem]">
                  {b.customer.name}{" "}
                  <span className="text-muted-foreground">
                    · {b.services.map((s) => s.name).join(", ")}
                  </span>
                </span>
                <span className="shrink-0 text-[0.72rem] text-muted-foreground">{b.reference}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <BookingDrawer reference={drawer} onClose={() => setDrawer(null)} />
    </>
  );
}

/* ── booking drawer ────────────────────────────────────────── */

type BookingPatch = {
  date?: string;
  time?: number;
  status?: "confirmed" | "cancelled";
  meta?: Record<string, unknown>;
  cancelReason?: string;
  customer?: { name: string; phone: string; email: string };
  staffId?: string;
};

const CANCEL_REASONS = [
  "Customer requested",
  "Studio unavailable",
  "Emergency",
  "Scheduling conflict",
  "Other",
];

const NEXT_STEP: Partial<Record<ApptStatus, { to: ApptStatus; label: string }>> = {
  pending: { to: "upcoming", label: "Confirm" },
  upcoming: { to: "arrived", label: "Check in" },
  arrived: { to: "in-chair", label: "Start service" },
  "in-chair": { to: "completed", label: "Mark completed" },
};

/** Right-side drawer on laptops, full-screen sheet on phones. */
export function BookingDrawer({
  reference,
  onClose,
  onChanged,
}: {
  reference: string | null;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { pin } = useAdmin();
  const [data, setData] = useState<Awaited<ReturnType<typeof adminBooking>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"view" | "reschedule" | "cancel" | "edit">("view");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!reference) return;
    setLoading(true);
    adminBooking({ data: { pin, reference } })
      .then(setData)
      .catch(() => toast.error("Couldn't load this booking."))
      .finally(() => setLoading(false));
  }, [pin, reference]);

  useEffect(() => {
    setMode("view");
    setData(null);
    load();
  }, [load]);

  const b = data?.booking ?? null;

  const patch = async (p: BookingPatch, done: string) => {
    if (!b) return false;
    setBusy(true);
    try {
      await adminUpsertBooking({ data: { pin, reference: b.reference, patch: p } });
      toast.success(done);
      load();
      onChanged?.();
      return true;
    } catch (e) {
      toast.error(
        e instanceof Error && e.message.length < 120
          ? e.message
          : "Couldn't save. Please try again.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  };

  const setStatus = (s: ApptStatus, label: string) => patch({ meta: { status: s } }, label);

  return (
    <Sheet open={Boolean(reference)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-[30rem]">
        <SheetHeader className="sticky top-0 z-10 border-b border-hairline bg-background/95 px-5 py-4 text-left backdrop-blur">
          <SheetTitle className="font-display text-[1.6rem] font-normal leading-tight">
            {b ? b.customer.name || "Booking" : "Booking"}
          </SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-2 text-[0.8rem]">
            {b ? (
              <>
                <StatusDot status={b.status} /> {b.reference}
                {b.source !== "online" ? (
                  <span className="text-muted-foreground">· {b.source}</span>
                ) : null}
              </>
            ) : loading ? (
              "Loading…"
            ) : (
              "Not found"
            )}
          </SheetDescription>
        </SheetHeader>

        {b ? (
          <div className="space-y-5 px-5 py-5">
            {/* appointment */}
            <section className="rounded-md border border-hairline p-4">
              <div className="flex items-baseline justify-between gap-3">
                <div className="font-display text-[1.35rem] leading-tight">
                  {dateLabel(b.date, { weekday: "long", day: "numeric", month: "long" })}
                </div>
                <div className="font-display text-[1.35rem]">{inr(b.price)}</div>
              </div>
              <div className="mt-0.5 text-[0.9rem] text-muted-foreground">
                {minuteLabel(b.time)} – {minuteLabel(b.time + b.minutes)} ·{" "}
                {formatDuration(b.minutes)}
              </div>
              <ul className="mt-3 space-y-1 text-[0.9rem]">
                {b.services.map((s) => (
                  <li key={s.id} className="flex justify-between gap-3">
                    <span>{s.name}</span>
                    <span className="text-muted-foreground">{inr(s.price)}</span>
                  </li>
                ))}
              </ul>
              {b.staffName ? (
                <p className="mt-3 flex items-center gap-2.5 text-[0.85rem]">
                  <StaffAvatar name={b.staffName} photo={b.staffPhoto} className="h-9 w-9" />
                  <span>
                    Stylist: <b className="font-medium">{b.staffName}</b>
                    <span className="text-muted-foreground">
                      {" "}
                      · {b.staffChosen ? "chosen by guest" : "assigned automatically"}
                    </span>
                  </span>
                </p>
              ) : null}
              {b.cancelReason ? (
                <p className="mt-3 text-[0.82rem] text-destructive">Cancelled: {b.cancelReason}</p>
              ) : null}
            </section>

            {/* actions */}
            {mode === "view" ? (
              <section className="flex flex-wrap gap-2">
                {NEXT_STEP[b.status] ? (
                  <Action
                    primary
                    disabled={busy}
                    onClick={() =>
                      void setStatus(
                        NEXT_STEP[b.status]!.to,
                        `${STATUS_LABEL[NEXT_STEP[b.status]!.to]}.`,
                      )
                    }
                  >
                    <Check className="h-4 w-4" /> {NEXT_STEP[b.status]!.label}
                  </Action>
                ) : null}
                {b.status !== "completed" && b.status !== "cancelled" && b.status !== "in-chair" ? (
                  <Action
                    disabled={busy}
                    onClick={() => void setStatus("completed", "Marked completed.")}
                  >
                    Mark completed
                  </Action>
                ) : null}
                {b.status !== "cancelled" && b.status !== "completed" ? (
                  <Action disabled={busy} onClick={() => setMode("reschedule")}>
                    <CalendarClock className="h-4 w-4" /> Reschedule
                  </Action>
                ) : null}
                {["pending", "upcoming", "arrived"].includes(b.status) ? (
                  <Action
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Mark ${b.customer.name} as a no-show?`))
                        void setStatus("no-show", "Marked no-show.");
                    }}
                  >
                    No-show
                  </Action>
                ) : null}
                {b.status !== "cancelled" && b.status !== "completed" ? (
                  <Action danger disabled={busy} onClick={() => setMode("cancel")}>
                    Cancel
                  </Action>
                ) : null}
                {b.status === "cancelled" || b.status === "no-show" ? (
                  <Action
                    disabled={busy}
                    onClick={() =>
                      void patch(
                        { status: "confirmed", meta: { status: "upcoming" } },
                        "Booking restored.",
                      )
                    }
                  >
                    Restore
                  </Action>
                ) : null}
              </section>
            ) : null}

            {mode === "reschedule" ? (
              <Reschedule
                booking={b}
                onCancel={() => setMode("view")}
                onConfirm={async (date, time, staffId) => {
                  const restaff = staffId !== (b.staffId ?? "any");
                  const moved = date !== b.date || time !== b.time;
                  if (
                    await patch(
                      { ...(moved ? { date, time } : {}), ...(restaff ? { staffId } : {}) },
                      moved ? "Booking rescheduled." : "Stylist changed.",
                    )
                  )
                    setMode("view");
                }}
                busy={busy}
              />
            ) : null}

            {mode === "cancel" ? (
              <CancelForm
                booking={b}
                busy={busy}
                onBack={() => setMode("view")}
                onConfirm={async (reason) => {
                  if (
                    await patch(
                      { status: "cancelled", meta: { status: "cancelled" }, cancelReason: reason },
                      "Booking cancelled.",
                    )
                  )
                    setMode("view");
                }}
              />
            ) : null}

            {/* contact */}
            <section className="rounded-md border border-hairline p-4">
              <div className="flex items-center justify-between">
                <Label>Customer</Label>
                {mode === "view" ? (
                  <button
                    onClick={() => setMode("edit")}
                    className="text-[0.8rem] text-bronze underline underline-offset-4"
                  >
                    Edit
                  </button>
                ) : null}
              </div>
              {mode === "edit" ? (
                <EditContact
                  booking={b}
                  busy={busy}
                  onCancel={() => setMode("view")}
                  onSave={async (c) => {
                    if (await patch({ customer: c }, "Details updated.")) setMode("view");
                  }}
                />
              ) : (
                <>
                  <div className="mt-2 text-[0.95rem]">{b.customer.name}</div>
                  <div className="text-[0.88rem] tabular-nums text-muted-foreground">
                    {b.customer.phone}
                  </div>
                  {b.customer.email ? (
                    <div className="text-[0.88rem] text-muted-foreground">{b.customer.email}</div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <a href={`tel:${b.customer.phone}`} className={ACTION}>
                      <Phone className="h-4 w-4" /> Call
                    </a>
                    <a
                      href={waLink(b.customer.phone)}
                      target="_blank"
                      rel="noreferrer"
                      className={ACTION}
                    >
                      <MessageCircle className="h-4 w-4" /> WhatsApp
                    </a>
                    <button
                      className={ACTION}
                      onClick={() =>
                        void navigator.clipboard
                          ?.writeText(b.customer.phone)
                          .then(() => toast.success("Phone number copied."))
                      }
                    >
                      <Copy className="h-4 w-4" /> Copy phone
                    </button>
                    {b.customerId ? (
                      <Link
                        to="/admin/customers"
                        search={{ id: b.customerId } as never}
                        className={ACTION}
                      >
                        Profile
                      </Link>
                    ) : null}
                  </div>
                  {b.customer.notes ? (
                    <p className="mt-3 text-[0.85rem]">Guest note: “{b.customer.notes}”</p>
                  ) : null}
                  {/* their track record (other bookings): helps spot repeat no-shows */}
                  {data?.record ? (
                    <div
                      className={cn(
                        "mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded px-3 py-2 text-[0.8rem]",
                        data.record.noShows
                          ? "bg-destructive/[0.07] text-destructive"
                          : "bg-foreground/[0.04] text-muted-foreground",
                      )}
                    >
                      <span>
                        {data.record.visits} {data.record.visits === 1 ? "visit" : "visits"}
                      </span>
                      <span aria-hidden>·</span>
                      <span className={data.record.noShows ? "font-medium" : ""}>
                        {data.record.noShows} {data.record.noShows === 1 ? "no-show" : "no-shows"}
                      </span>
                      <span aria-hidden>·</span>
                      <span>
                        {data.record.lateCancels} late{" "}
                        {data.record.lateCancels === 1 ? "cancellation" : "cancellations"}
                      </span>
                      {data.record.noShows >= 2 ? (
                        <span className="w-full text-[0.74rem]">
                          Books by phone only (2+ no-shows this year).
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  {data?.customerNotes ? (
                    <p className="mt-2 rounded bg-champagne/15 px-3 py-2 text-[0.85rem]">
                      Internal: {data.customerNotes}
                    </p>
                  ) : null}
                  {b.customer.photos ? (
                    <RefPhotos reference={b.reference} count={b.customer.photos} />
                  ) : null}
                </>
              )}
            </section>

            {/* internal note + payment */}
            <InternalNote
              booking={b}
              busy={busy}
              onSave={(note) => void patch({ meta: { note } }, "Note saved.")}
            />
            <PaymentRow
              booking={b}
              busy={busy}
              onSave={(payment, amount) =>
                void patch({ meta: { payment, amount } }, "Payment recorded.")
              }
            />

            <WhatsAppSend booking={b} />

            <BookingMessages
              reference={b.reference}
              version={data?.booking ? b.history.length + b.status : ""}
            />

            {/* history */}
            <section>
              <Label>History</Label>
              <ul className="mt-2 space-y-1.5 text-[0.82rem] text-muted-foreground">
                <li>
                  Booked{" "}
                  {new Date(b.createdAt).toLocaleString("en-GB", {
                    timeZone: "Asia/Kolkata",
                    day: "numeric",
                    month: "short",
                    hour: "numeric",
                    minute: "2-digit",
                  })}{" "}
                  · {b.source}
                </li>
                {b.history.map((h, i) => (
                  <li key={i}>
                    {new Date(h.at).toLocaleString("en-GB", {
                      timeZone: "Asia/Kolkata",
                      day: "numeric",
                      month: "short",
                      hour: "numeric",
                      minute: "2-digit",
                    })}{" "}
                    · {h.by} {h.action.replace("status:", "→ ")}
                    {h.from && h.to
                      ? ` ${dateLabel(h.from.date)} ${minuteLabel(h.from.time)} → ${dateLabel(h.to.date)} ${minuteLabel(h.to.time)}`
                      : ""}
                    {h.reason ? ` (${h.reason})` : ""}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** The guest's reference photos, fetched on demand as short-lived private links. */
function RefPhotos({ reference, count }: { reference: string; count: number }) {
  const { pin } = useAdmin();
  const [urls, setUrls] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    adminReferencePhotos({ data: { pin, reference } })
      .then((r) => live && setUrls(r.urls))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [pin, reference]);
  return (
    <div className="mt-3">
      <Label>Reference photos · deleted when completed</Label>
      <div className="mt-2 flex gap-2">
        {failed ? (
          <span className="text-xs text-destructive">Couldn't load photos.</span>
        ) : urls === null ? (
          Array.from({ length: count }, (_, i) => (
            <span key={i} className="h-20 w-20 animate-pulse rounded-md bg-muted" />
          ))
        ) : urls.length === 0 ? (
          <span className="text-xs text-muted-foreground">Photos have been removed.</span>
        ) : (
          urls.map((u) => (
            <a key={u} href={u} target="_blank" rel="noreferrer" className="press block">
              <img src={u} alt="Guest reference" className="h-20 w-20 rounded-md object-cover" />
            </a>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Free messaging: opens WhatsApp on this device with the message written out
 * (from the booking's stored details). The salon taps Send in its own WhatsApp.
 */
function WhatsAppSend({ booking: b }: { booking: AdminBooking }) {
  const facts: BookingFacts = {
    reference: b.reference,
    customerName: b.customer.name || "there",
    customerPhone: b.customer.phone,
    date: b.date,
    time: b.time,
    services: b.services.map((s) => s.name),
    minutes: b.minutes,
    price: b.price,
    priceFrom: false,
    location: BUSINESS.locationShort || BUSINESS.address,
    manageUrl:
      typeof window !== "undefined" ? `${window.location.origin}/manage?ref=${b.reference}` : "",
  };
  const moved = b.history.some((h) => h.action === "rescheduled");
  const options: { event: NotifyEvent; label: string }[] =
    b.status === "cancelled"
      ? [{ event: "BOOKING_CANCELLED", label: "Cancellation" }]
      : [
          { event: "BOOKING_CONFIRMED", label: "Confirmation" },
          { event: "BOOKING_REMINDER_24H", label: "Reminder" },
          ...(moved ? [{ event: "BOOKING_RESCHEDULED" as const, label: "New time" }] : []),
        ];
  if (!b.customer.phone) return null;
  return (
    <section>
      <Label>Send on WhatsApp (free)</Label>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((o) => (
          <a
            key={o.event}
            href={whatsapp(b.customer.phone, messageText("customer", o.event, facts))}
            target="_blank"
            rel="noreferrer"
            className={ACTION}
          >
            <MessageCircle className="h-4 w-4" /> {o.label}
          </a>
        ))}
      </div>
      <p className="mt-1.5 text-[0.74rem] text-muted-foreground">
        Opens WhatsApp with the message ready — just tap Send.
      </p>
    </section>
  );
}

/** What was sent about this booking, and whether it arrived. */
function BookingMessages({ reference, version }: { reference: string; version: string }) {
  const { pin } = useAdmin();
  const [logs, setLogs] = useState<NotifyLog[] | null>(null);
  useEffect(() => {
    let live = true;
    adminNotificationLogs({ data: { pin, bookingId: reference, page: 0 } })
      .then((r) => live && setLogs(r.available ? r.logs : []))
      .catch(() => live && setLogs([]));
    return () => {
      live = false;
    };
  }, [pin, reference, version]);
  if (!logs?.length) return null;
  const who = (r: string) => (r === "admin" ? "Salon" : "Guest");
  const icon = (st: string) =>
    st === "delivered" || st === "sent" ? "✓" : st === "failed" || st === "skipped" ? "⚠" : "•";
  return (
    <section>
      <Label>Messages</Label>
      <ul className="mt-2 space-y-1.5 text-[0.82rem]">
        {logs.map((l) => (
          <li key={l.id} className="flex items-start gap-2">
            <span className={cn("w-3 shrink-0", MSG_TONE[l.status])}>{icon(l.status)}</span>
            <span className="min-w-0 flex-1">
              {who(l.recipient)} {l.eventLabel.toLowerCase()} —{" "}
              {l.channel === "whatsapp" ? "WhatsApp" : l.channel === "email" ? "Email" : "SMS"}
              {l.fallback ? " (fallback)" : ""}
              {l.errorMessage && ["failed", "skipped"].includes(l.status) ? (
                <span className="block text-[0.74rem] text-muted-foreground">{l.errorMessage}</span>
              ) : null}
            </span>
            <span
              className={cn(
                "shrink-0 text-[0.72rem] font-medium uppercase tracking-[0.06em]",
                MSG_TONE[l.status],
              )}
            >
              {l.status === "scheduled" && l.scheduledFor
                ? `Scheduled ${new Date(l.scheduledFor).toLocaleString("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`
                : l.status}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const MSG_TONE: Record<string, string> = {
  delivered: "text-emerald-700",
  sent: "text-emerald-700",
  failed: "text-destructive",
  skipped: "text-amber-700",
  scheduled: "text-muted-foreground",
  cancelled: "text-muted-foreground line-through",
};

const ACTION =
  "press inline-flex min-h-9 items-center gap-1.5 rounded-md border border-foreground/15 px-3 py-1.5 text-[0.82rem] hover:border-foreground/45";

function Action({
  children,
  onClick,
  primary,
  danger,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        ACTION,
        primary && "border-foreground bg-foreground text-background hover:bg-foreground/88",
        danger && "border-destructive/35 text-destructive hover:border-destructive",
        "disabled:opacity-40",
      )}
    >
      {children}
    </button>
  );
}

const Label = ({ children }: { children: ReactNode }) => (
  <div className="text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground">{children}</div>
);

function StatusDot({ status }: { status: ApptStatus }) {
  const color: Record<ApptStatus, string> = {
    pending: "bg-amber-500",
    upcoming: "bg-foreground/50",
    arrived: "bg-bronze",
    "in-chair": "bg-foreground",
    completed: "bg-emerald-600",
    "no-show": "bg-destructive",
    cancelled: "bg-destructive/50",
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-2 w-2 rounded-full", color[status])} />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Day + free times picker, shared by reschedule and new booking. */
export function TimePicker({
  audience,
  serviceIds,
  reference,
  date,
  onDate,
  time,
  onTime,
  staffId,
  onStaffId,
}: {
  audience: Audience;
  serviceIds: string[];
  reference?: string;
  date: string;
  onDate: (d: string) => void;
  time: number | null;
  onTime: (t: number | null) => void;
  /** Stylist: "any" or an id; shown as chips when the salon has stylists. */
  staffId?: string | undefined;
  onStaffId?: ((id: string) => void) | undefined;
}) {
  const { pin } = useAdmin();
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [closed, setClosed] = useState(false);
  const [team, setTeam] = useState<{ id: string; name: string }[]>([]);
  const key = serviceIds.join(",");
  useEffect(() => {
    if (!key) {
      setSlots([]);
      return;
    }
    let live = true;
    setSlots(null);
    adminAvailability({
      data: {
        pin,
        date,
        audience,
        serviceIds: key.split(","),
        ...(reference ? { reference } : {}),
        ...(staffId ? { staffId } : {}),
      },
    })
      .then((r) => {
        if (!live) return;
        setClosed(r.closed);
        setTeam(r.stylists ?? []);
        setSlots(r.slots.filter((s) => s.reason !== "break"));
      })
      .catch(() => live && setSlots([]));
    return () => {
      live = false;
    };
  }, [pin, date, audience, key, reference, staffId]);

  return (
    <div>
      {onStaffId && team.length ? (
        <div className="mb-3 flex flex-wrap gap-1.5" aria-label="Stylist">
          {[{ id: "any", name: "Any available" }, ...team].map((t) => {
            const on = (staffId ?? "any") === t.id;
            return (
              <button
                key={t.id}
                onClick={() => {
                  onStaffId(t.id);
                  onTime(null);
                }}
                className={cn(
                  "press rounded-full border px-3 py-1 text-[0.8rem]",
                  on ? "border-foreground bg-foreground text-background" : "border-foreground/15",
                )}
              >
                {t.name}
              </button>
            );
          })}
        </div>
      ) : null}
      <input
        type="date"
        value={date}
        min={salonToday()}
        onChange={(e) => {
          onDate(e.target.value);
          onTime(null);
        }}
        className="w-full rounded-md border border-foreground/15 bg-background px-3 py-2 text-[0.9rem]"
      />
      <div className="mt-3 grid grid-cols-4 gap-1.5 sm:grid-cols-5">
        {slots === null ? (
          <span className="col-span-full text-[0.82rem] text-muted-foreground">
            Checking free times…
          </span>
        ) : closed ? (
          <span className="col-span-full text-[0.82rem] text-muted-foreground">
            The studio is closed that day.
          </span>
        ) : !slots.length ? (
          <span className="col-span-full text-[0.82rem] text-muted-foreground">
            Choose a service to see times.
          </span>
        ) : (
          slots.map((s) => (
            <button
              key={s.minute}
              disabled={!s.available}
              onClick={() => onTime(s.minute)}
              className={cn(
                "press rounded-md border px-1 py-1.5 text-[0.8rem] tabular-nums",
                time === s.minute
                  ? "border-foreground bg-foreground text-background"
                  : s.available
                    ? "border-foreground/15 hover:border-foreground/50"
                    : "border-transparent bg-foreground/[0.04] text-foreground/30 line-through",
              )}
              title={s.available ? undefined : (s.reason ?? undefined)}
            >
              {minuteLabel(s.minute)}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function Reschedule({
  booking,
  onCancel,
  onConfirm,
  busy,
}: {
  booking: AdminBooking;
  onCancel: () => void;
  onConfirm: (date: string, time: number, staffId: string) => void;
  busy: boolean;
}) {
  const [date, setDate] = useState(booking.date);
  const [time, setTime] = useState<number | null>(null);
  const [staffId, setStaffId] = useState<string>(booking.staffId ?? "any");
  return (
    <section className="rounded-md border border-foreground/25 p-4">
      <Label>Reschedule or change stylist</Label>
      <div className="mt-3">
        <TimePicker
          audience={booking.audience}
          serviceIds={booking.serviceIds}
          reference={booking.reference}
          date={date}
          onDate={setDate}
          time={time}
          onTime={setTime}
          staffId={staffId}
          onStaffId={setStaffId}
        />
      </div>
      {time != null ? (
        <p className="mt-3 text-[0.85rem]">
          Move {dateLabel(booking.date)} {minuteLabel(booking.time)} →{" "}
          <b>
            {dateLabel(date)} {minuteLabel(time)}
          </b>
          ?
        </p>
      ) : null}
      <div className="mt-3 flex gap-2">
        <Action
          primary
          disabled={time == null || busy}
          onClick={() => time != null && onConfirm(date, time, staffId)}
        >
          Confirm move
        </Action>
        <Action onClick={onCancel}>Back</Action>
      </div>
    </section>
  );
}

function CancelForm({
  booking,
  busy,
  onBack,
  onConfirm,
}: {
  booking: AdminBooking;
  busy: boolean;
  onBack: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState(CANCEL_REASONS[0]!);
  const [other, setOther] = useState("");
  return (
    <section className="rounded-md border border-destructive/30 bg-destructive/[0.03] p-4">
      <Label>Cancel appointment</Label>
      <p className="mt-2 text-[0.88rem]">
        {booking.customer.name} · {booking.services.map((s) => s.name).join(", ")}
        <br />
        {dateLabel(booking.date, { weekday: "long", day: "numeric", month: "long" })} at{" "}
        {minuteLabel(booking.time)}
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {CANCEL_REASONS.map((r) => (
          <button
            key={r}
            onClick={() => setReason(r)}
            className={cn(
              "press rounded-full border px-3 py-1 text-[0.78rem]",
              reason === r
                ? "border-foreground bg-foreground text-background"
                : "border-foreground/15",
            )}
          >
            {r}
          </button>
        ))}
      </div>
      {reason === "Other" ? (
        <input
          value={other}
          onChange={(e) => setOther(e.target.value)}
          placeholder="Reason"
          className="mt-2 w-full rounded-md border border-foreground/15 px-3 py-2 text-[0.9rem]"
        />
      ) : null}
      <p className="mt-3 text-[0.78rem] text-muted-foreground">
        The booking stays in history and can be restored.
      </p>
      <div className="mt-3 flex gap-2">
        <Action
          danger
          disabled={busy}
          onClick={() => onConfirm(reason === "Other" ? other || "Other" : reason)}
        >
          Cancel appointment
        </Action>
        <Action onClick={onBack}>Keep it</Action>
      </div>
    </section>
  );
}

function EditContact({
  booking,
  busy,
  onCancel,
  onSave,
}: {
  booking: AdminBooking;
  busy: boolean;
  onCancel: () => void;
  onSave: (c: { name: string; phone: string; email: string }) => void;
}) {
  const [c, setC] = useState({
    name: booking.customer.name,
    phone: booking.customer.phone,
    email: booking.customer.email,
  });
  const field = "w-full rounded-md border border-foreground/15 px-3 py-2 text-[0.9rem]";
  return (
    <div className="mt-3 space-y-2">
      <input
        className={field}
        value={c.name}
        onChange={(e) => setC({ ...c, name: e.target.value })}
        placeholder="Name"
      />
      <input
        className={field}
        value={c.phone}
        onChange={(e) => setC({ ...c, phone: e.target.value })}
        placeholder="Phone"
        inputMode="tel"
      />
      <input
        className={field}
        value={c.email}
        onChange={(e) => setC({ ...c, email: e.target.value })}
        placeholder="Email"
      />
      <div className="flex gap-2">
        <Action primary disabled={busy || !c.name.trim()} onClick={() => onSave(c)}>
          Save
        </Action>
        <Action onClick={onCancel}>Cancel</Action>
      </div>
    </div>
  );
}

function InternalNote({
  booking,
  busy,
  onSave,
}: {
  booking: AdminBooking;
  busy: boolean;
  onSave: (n: string) => void;
}) {
  const [note, setNote] = useState(booking.note);
  useEffect(() => setNote(booking.note), [booking.note]);
  const dirty = note !== booking.note;
  return (
    <section>
      <Label>Internal note (staff only)</Label>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="e.g. Prefers a low fade"
        className="mt-2 w-full resize-none rounded-md border border-foreground/15 px-3 py-2 text-[0.88rem]"
      />
      {dirty ? (
        <div className="mt-1.5 flex gap-2">
          <Action primary disabled={busy} onClick={() => onSave(note)}>
            Save note
          </Action>
          <Action onClick={() => setNote(booking.note)}>Discard</Action>
        </div>
      ) : null}
    </section>
  );
}

function PaymentRow({
  booking,
  busy,
  onSave,
}: {
  booking: AdminBooking;
  busy: boolean;
  onSave: (method: string, amount: number) => void;
}) {
  const [amount, setAmount] = useState(String(booking.amountPaid ?? booking.price));
  return (
    <section>
      <Label>Payment</Label>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
          inputMode="numeric"
          className="w-24 rounded-md border border-foreground/15 px-3 py-1.5 text-[0.88rem] tabular-nums"
          aria-label="Amount"
        />
        {(["cash", "upi", "card", "unpaid"] as const).map((m) => (
          <button
            key={m}
            disabled={busy}
            onClick={() => onSave(m, Number(amount || 0))}
            className={cn(
              "press rounded-full border px-3 py-1 text-[0.78rem] uppercase tracking-[0.06em]",
              booking.payment === m
                ? "border-foreground bg-foreground text-background"
                : "border-foreground/15",
            )}
          >
            {m}
          </button>
        ))}
      </div>
    </section>
  );
}

/* ── new booking / walk-in ─────────────────────────────────── */

const SOURCES = [
  { key: "walk-in", label: "Walk-in" },
  { key: "phone", label: "Phone" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "admin", label: "Other" },
] as const;

export function NewBookingDialog({
  open,
  onOpenChange,
  initialDate,
  initialTime,
  initialStaffId,
  customer: presetCustomer,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialDate?: string;
  initialTime?: number | null;
  initialStaffId?: string | undefined;
  customer?: { name: string; phone: string; email: string } | null;
  onCreated?: (reference: string) => void;
}) {
  const { pin } = useAdmin();
  const [audience, setAudience] = useState<Audience>("men");
  const [ids, setIds] = useState<string[]>([]);
  const [date, setDate] = useState(initialDate ?? salonToday());
  const [time, setTime] = useState<number | null>(initialTime ?? null);
  const [staffId, setStaffId] = useState<string>(initialStaffId ?? "any");
  const [source, setSource] = useState<(typeof SOURCES)[number]["key"]>("walk-in");
  const [cust, setCust] = useState({ name: "", phone: "", email: "" });
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<AdminCustomer[]>([]);
  const [svcQ, setSvcQ] = useState("");
  const [known, setKnown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const first = useRef(true);

  useEffect(() => {
    if (!open) return;
    setDate(initialDate ?? salonToday());
    setTime(initialTime ?? null);
    setStaffId(initialStaffId ?? "any");
    setIds([]);
    setError("");
    setCust(presetCustomer ?? { name: "", phone: "", email: "" });
    setQ("");
    setSvcQ("");
    setKnown(false);
    first.current = true;
  }, [open, initialDate, initialTime, initialStaffId, presetCustomer]);

  // a phone number typed in full that belongs to a customer: fill their name and email
  const phoneKey = cust.phone.replace(/\D/g, "").slice(-10);
  useEffect(() => {
    if (phoneKey.length !== 10) return setKnown(false);
    let live = true;
    const t = window.setTimeout(() => {
      adminCustomers({ data: { pin, q: phoneKey, page: 0 } })
        .then((r) => {
          const m = r.customers.find((c) => c.phone.replace(/\D/g, "").slice(-10) === phoneKey);
          if (!live || !m) return setKnown(false);
          setKnown(true);
          // only fill what's empty, never overwrite what the admin typed
          setCust((c) => ({
            ...c,
            name: c.name.trim() ? c.name : m.name,
            email: c.email.trim() ? c.email : (m.email ?? ""),
          }));
        })
        .catch(() => {});
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [phoneKey, pin]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return setMatches([]);
    const t = window.setTimeout(() => {
      adminCustomers({ data: { pin, q: term, page: 0 } })
        .then((r) => setMatches(r.customers.slice(0, 5)))
        .catch(() => setMatches([]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [q, pin]);

  const menu = useMemo(() => menuFor(audience), [audience]);
  // the services search: by service or category name
  const shownMenu = useMemo(() => {
    const t = svcQ.trim().toLowerCase();
    if (!t) return menu;
    return menu
      .map((c) => ({
        ...c,
        services: c.title.toLowerCase().includes(t)
          ? c.services
          : c.services.filter((x) => x.name.toLowerCase().includes(t)),
      }))
      .filter((c) => c.services.length);
  }, [menu, svcQ]);
  const chosen = menu.flatMap((c) => c.services).filter((s) => ids.includes(s.id));
  const total = chosen.reduce((n, s) => n + s.price, 0);
  const minutes = chosen.reduce((n, s) => n + s.minutes, 0);

  const create = async () => {
    if (!cust.name.trim() || cust.phone.replace(/\D/g, "").length < 10)
      return setError("Add the customer's name and a 10-digit phone.");
    if (!ids.length) return setError("Choose at least one service.");
    if (time == null) return setError("Choose a time.");
    setBusy(true);
    setError("");
    try {
      const r = (await adminUpsertBooking({
        data: {
          pin,
          reference: "new",
          insert: {
            audience,
            serviceIds: ids,
            date,
            time,
            customer: {
              name: cust.name.trim(),
              phone: cust.phone.trim(),
              email: cust.email.trim(),
            },
            source,
            ...(staffId !== "any" ? { staffId } : {}),
          },
        },
      })) as { reference?: string };
      toast.success(`Booked ${cust.name.trim()} for ${minuteLabel(time)}.`);
      onCreated?.(r.reference ?? "");
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the booking.");
    } finally {
      setBusy(false);
    }
  };

  const field = "w-full rounded-md border border-foreground/15 px-3 py-2 text-[0.9rem]";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-[1.7rem] font-normal">New booking</DialogTitle>
          <DialogDescription>
            Walk-ins, phone and WhatsApp bookings appear in the calendar immediately.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div>
            <Label>Customer</Label>
            {!presetCustomer ? (
              <div className="relative mt-2">
                <input
                  className={field}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Find an existing customer (name or phone)"
                />
                {matches.length ? (
                  <div className="absolute inset-x-0 top-full z-10 mt-1 rounded-md border border-hairline bg-background p-1 shadow-lg">
                    {matches.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => {
                          setCust({ name: m.name, phone: m.phone, email: m.email ?? "" });
                          setKnown(true);
                          setQ("");
                          setMatches([]);
                        }}
                        className="flex w-full justify-between rounded px-3 py-2 text-left text-[0.88rem] hover:bg-foreground/[0.04]"
                      >
                        {m.name}{" "}
                        <span className="tabular-nums text-muted-foreground">{m.phone}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <input
                className={field}
                value={cust.name}
                onChange={(e) => setCust({ ...cust, name: e.target.value })}
                placeholder="Name"
              />
              <input
                className={field}
                value={cust.phone}
                onChange={(e) => setCust({ ...cust, phone: e.target.value })}
                placeholder="Phone"
                inputMode="tel"
              />
              <input
                className={field}
                value={cust.email}
                onChange={(e) => setCust({ ...cust, email: e.target.value })}
                placeholder="Email (optional)"
              />
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-[0.75rem] text-muted-foreground">
              {known ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-700" /> Existing customer — details
                  filled in.
                </>
              ) : (
                <>
                  <UserPlus className="h-3.5 w-3.5" /> New numbers create a customer record
                  automatically.
                </>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label>Services</Label>
              <div className="flex gap-1">
                {(["men", "women"] as const).map((a) => (
                  <button
                    key={a}
                    onClick={() => {
                      setAudience(a);
                      setIds([]);
                      setTime(null);
                      setSvcQ("");
                    }}
                    className={cn(
                      "press rounded-full border px-3 py-0.5 text-[0.75rem] capitalize",
                      audience === a
                        ? "border-foreground bg-foreground text-background"
                        : "border-foreground/15",
                    )}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>
            <div className="relative mt-2">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                strokeWidth={1.5}
              />
              <input
                className={cn(field, "pl-9")}
                value={svcQ}
                onChange={(e) => setSvcQ(e.target.value)}
                placeholder="Search services (e.g. haircut, facial, colour)"
                aria-label="Search services"
              />
            </div>
            <div className="mt-2 max-h-48 space-y-3 overflow-y-auto rounded-md border border-hairline p-3">
              {shownMenu.length === 0 ? (
                <p className="py-3 text-center text-[0.85rem] text-muted-foreground">
                  No services match “{svcQ}”.
                </p>
              ) : null}
              {shownMenu.map((c) => (
                <div key={c.id}>
                  <div className="text-[0.7rem] uppercase tracking-[0.16em] text-muted-foreground">
                    {c.title}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {c.services.map((s) => {
                      const on = ids.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          onClick={() => {
                            setIds((v) => (on ? v.filter((x) => x !== s.id) : [...v, s.id]));
                            setTime(null);
                          }}
                          className={cn(
                            "press rounded-full border px-3 py-1 text-[0.8rem]",
                            on
                              ? "border-foreground bg-foreground text-background"
                              : "border-foreground/15 hover:border-foreground/40",
                          )}
                        >
                          {s.name} · {inr(s.price)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            {chosen.length ? (
              <div className="mt-1.5 text-[0.82rem] text-muted-foreground">
                {formatDuration(minutes)} · {inr(total)}
              </div>
            ) : null}
          </div>

          <div>
            <Label>Date & time</Label>
            <div className="mt-2">
              <TimePicker
                audience={audience}
                serviceIds={ids}
                date={date}
                onDate={setDate}
                time={time}
                onTime={setTime}
                staffId={staffId}
                onStaffId={setStaffId}
              />
            </div>
          </div>

          <div>
            <Label>Booked via</Label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {SOURCES.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setSource(s.key)}
                  className={cn(
                    "press rounded-full border px-3 py-1 text-[0.8rem]",
                    source === s.key
                      ? "border-foreground bg-foreground text-background"
                      : "border-foreground/15",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {error ? (
            <p role="alert" className="shake text-[0.85rem] text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Action onClick={() => onOpenChange(false)}>Cancel</Action>
            <Action primary disabled={busy} onClick={() => void create()}>
              {busy ? "Booking…" : "Create booking"}
            </Action>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── block time / close day ────────────────────────────────── */

const BLOCK_REASONS = [
  "Personal work",
  "Emergency",
  "Maintenance",
  "Walk-in reserved",
  "Staff unavailable",
  "Other",
];
const CLOSE_REASONS = ["Holiday", "Personal leave", "Emergency", "Private event", "Maintenance"];

const timeOptions = (from = 8 * 60, to = 22 * 60, step = 15) => {
  const out: number[] = [];
  for (let m = from; m <= to; m += step) out.push(m);
  return out;
};

type DaySnap = Awaited<ReturnType<typeof adminDay>>;
type CellState = "free" | "booked" | "blocked" | "break" | "off" | "past";
type Cell = { m: number; state: CellState; label: string };
type Run = { start: number; end: number };

const isLive = (s: string) => s !== "cancelled" && s !== "no-show";
const overlaps = (a: number, b: number, s: number, e: number) => a < e && s < b;
const pickable = (c: Cell) => c.state === "free" || c.state === "booked";
const DAY_PARTS = [
  { key: "morning", label: "Morning", from: 0, to: 13 * 60 },
  { key: "afternoon", label: "Afternoon", from: 13 * 60, to: 17 * 60 },
  { key: "evening", label: "Evening", from: 17 * 60, to: 24 * 60 },
] as const;

/** Picked slot starts → continuous stretches ("3:00–4:00" and "5:30–6:00"). */
function toRuns(picked: number[], step: number): Run[] {
  const out: Run[] = [];
  for (const m of [...picked].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last && last.end === m) last.end = m + step;
    else out.push({ start: m, end: m + step });
  }
  return out;
}
const runLabel = (r: Run) => `${minuteLabel(r.start)} – ${minuteLabel(r.end)}`;

/**
 * Block time: the chosen day's slots, laid out like the guest's time page.
 * Tap slots, or tap a start and an end for a range (drag works too with a mouse);
 * booked slots show as "Booked" so a clash is visible before saving. Blocks
 * the whole salon (every stylist) or one stylist. Exact times stay available
 * for odd minutes.
 */
export function BlockTimeDialog({
  open,
  onOpenChange,
  initialDate,
  initialStart,
  initialStaffId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialDate?: string;
  initialStart?: number;
  initialStaffId?: string;
  onSaved?: () => void;
}) {
  const { pin } = useAdmin();
  const [date, setDate] = useState(initialDate ?? salonToday());
  const [who, setWho] = useState<string>("salon");
  const [kind, setKind] = useState<"block" | "break">("block");
  const [reason, setReason] = useState(BLOCK_REASONS[0]!);
  const [day, setDay] = useState<DaySnap | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [picked, setPicked] = useState<number[]>([]);
  /** A From–Until range set with the time boxes (the grid's taps are `picked`). */
  const [exact, setExact] = useState<Run | null>(null);
  const [clashes, setClashes] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const savedRuns = useRef(0);
  const drag = useRef<{ start: number; base: number[]; add: boolean; moved: boolean } | null>(null);
  const skipClick = useRef(false);

  useEffect(() => {
    if (!open) return;
    setDate(initialDate ?? salonToday());
    setWho(initialStaffId ?? "salon");
    setKind("block");
    setPicked([]);
    setExact(initialStart != null ? { start: initialStart, end: initialStart + 60 } : null);
    setClashes([]);
    setError("");
    savedRuns.current = 0;
  }, [open, initialDate, initialStart, initialStaffId]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setDay(null);
    setLoadFailed(false);
    adminDay({ data: { pin, date } })
      .then((d) => live && setDay(d))
      .catch(() => live && setLoadFailed(true));
    return () => {
      live = false;
    };
  }, [open, date, pin, reload]);

  const step = day?.interval || 30;
  const member = who === "salon" ? null : (day?.team?.find((t) => t.id === who) ?? null);

  const cells = useMemo<Cell[] | null>(() => {
    if (!day || day.plan.closed) return null;
    const plan = day.plan;
    const today = day.now.iso === date;
    const bookings = day.bookings.filter(
      (b) => isLive(b.status) && (!member || b.staffId === member.id),
    );
    const out: Cell[] = [];
    for (let m = plan.open; m <= plan.close; m += step) {
      const e = m + step;
      const hit = (r: { start: number; end: number }) => overlaps(m, e, r.start, r.end);
      const brk = plan.breaks.find(hit) ?? member?.breaks.find(hit);
      const blk = plan.blocks.find(hit) ?? member?.blocks.find(hit);
      const off =
        member &&
        (!member.working ||
          member.start == null ||
          member.end == null ||
          m < member.start ||
          m > member.end);
      let cell: Cell;
      if (today && e <= day.now.minute) cell = { m, state: "past", label: "Earlier today" };
      else if (off) cell = { m, state: "off", label: `${member.name} not working` };
      else if (brk) cell = { m, state: "break", label: brk.label || "Break" };
      else if (blk) cell = { m, state: "blocked", label: blk.label || "Blocked" };
      else if (bookings.some((b) => overlaps(m, e, b.time, b.end)))
        cell = { m, state: "booked", label: "Booked" };
      else cell = { m, state: "free", label: "" };
      out.push(cell);
    }
    return out;
  }, [day, date, member, step]);

  // keep only slots that can still be picked (after switching stylist or reloading)
  useEffect(() => {
    if (!cells) return;
    const ok = new Set(cells.filter(pickable).map((c) => c.m));
    setPicked((p) => (p.every((m) => ok.has(m)) ? p : p.filter((m) => ok.has(m))));
  }, [cells]);

  const runs: Run[] = exact ? [exact] : toRuns(picked, step);
  const covered = useMemo(() => {
    if (!day) return [] as number[];
    const list = day.bookings.filter(
      (b) =>
        isLive(b.status) &&
        (!member || b.staffId === member.id) &&
        runs.some((r) => overlaps(r.start, r.end, b.time, b.end)),
    );
    return [...new Set(list.map((b) => b.time))].sort((a, b) => a - b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, member, JSON.stringify(runs)]);

  const changed = () => {
    setClashes([]);
    setError("");
    savedRuns.current = 0;
  };
  const setSel = (next: number[]) => {
    setPicked([...new Set(next)].sort((a, b) => a - b));
    setExact(null);
    changed();
  };
  const between = (a: number, b: number) =>
    (cells ?? [])
      .filter((c) => pickable(c) && c.m >= Math.min(a, b) && c.m <= Math.max(a, b))
      .map((c) => c.m);

  /** The selection as slots: a From–Until range turns into the slots it covers. */
  const current = () =>
    exact
      ? (cells ?? [])
          .filter((c) => pickable(c) && overlaps(c.m, c.m + step, exact.start, exact.end))
          .map((c) => c.m)
      : picked;
  const tap = (m: number) => {
    if (skipClick.current) {
      skipClick.current = false;
      return;
    }
    const base = current();
    setSel(base.includes(m) ? base.filter((x) => x !== m) : [...base, m]);
  };

  const cellAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest("[data-slot]") as HTMLElement | null;
    return el ? Number(el.dataset["slot"]) : null;
  };
  const onDown = (m: number, e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    const base = current();
    drag.current = { start: m, base, add: !base.includes(m), moved: false };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !(e.buttons & 1)) return;
    const m = cellAt(e.clientX, e.clientY);
    if (m == null || (m === d.start && !d.moved)) return;
    d.moved = true;
    const span = between(d.start, m);
    setSel(d.add ? [...d.base, ...span] : d.base.filter((x) => !span.includes(x)));
  };
  const onUp = () => {
    if (drag.current?.moved) {
      // swallow only the click that ends this drag (none fires when it ends on another slot)
      skipClick.current = true;
      setTimeout(() => (skipClick.current = false), 0);
    }
    drag.current = null;
  };

  const partSlots = (from: number, to: number) =>
    (cells ?? []).filter((c) => pickable(c) && c.m >= from && c.m < to).map((c) => c.m);
  const quick = (from: number, to: number) => {
    const span = partSlots(from, to);
    if (!span.length) return;
    const base = current();
    const all = span.every((m) => base.includes(m));
    setSel(all ? base.filter((m) => !span.includes(m)) : [...base, ...span]);
  };

  const unblock = async (item: { id: string; staff: boolean }) => {
    try {
      const r = item.staff
        ? await adminRemoveStaffTime({ data: { pin, kind: "block", id: item.id } })
        : await adminArchiveBlock({ data: { pin, id: item.id } });
      if (!r.ok) throw new Error();
      toast.success("Unblocked.");
      setReload((n) => n + 1);
      onSaved?.();
    } catch {
      toast.error("Couldn't unblock. Please try again.");
    }
  };

  const save = async (confirm = false) => {
    if (!runs.length) return setError("Tap the slots to block, or use exact times.");
    if (runs.some((r) => r.end <= r.start)) return setError("End must be after start.");
    if (!confirm && covered.length) return setClashes(covered);
    setBusy(true);
    setError("");
    try {
      for (let i = savedRuns.current; i < runs.length; i++) {
        const r = runs[i]!;
        const res = member
          ? await adminAddStaffBlock({
              data: {
                pin,
                staffId: member.id,
                date,
                start: r.start,
                end: r.end,
                reason,
                ...(confirm ? { confirm: true } : {}),
              },
            })
          : await adminSaveBlock({
              data: {
                pin,
                date,
                start: r.start,
                end: r.end,
                kind,
                reason,
                ...(confirm ? { confirm: true } : {}),
              },
            });
        if (!res.ok && "clashes" in res && res.clashes?.length)
          return setClashes(res.clashes.map((c) => c.time));
        if (!res.ok) return setError(("error" in res && res.error) || "Couldn't save.");
        savedRuns.current = i + 1;
      }
      toast.success(
        kind === "break" && !member
          ? "Break added."
          : `Blocked ${runs.map(runLabel).join(" and ")}${member ? ` for ${member.name}` : ""}.`,
      );
      onSaved?.();
      onOpenChange(false);
    } catch {
      setError(
        savedRuns.current
          ? "Some of it was saved, the rest couldn't be. Please check and try again."
          : "Couldn't save. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  // what's already blocked this day (salon blocks apply to every stylist)
  const existing = useMemo(() => {
    if (!day) return [];
    const salon = day.blocks.map((b) => ({
      id: b.id,
      staff: false,
      start: b.start,
      end: b.end,
      reason: b.reason || (b.kind === "break" ? "Break" : "Blocked"),
      who: b.kind === "break" ? "Whole salon · break" : "Whole salon",
    }));
    const team = (day.team ?? [])
      .filter((t) => !member || t.id === member.id)
      .flatMap((t) =>
        t.blocks
          .filter((b) => b.id)
          .map((b) => ({
            id: b.id!,
            staff: true,
            start: b.start,
            end: b.end,
            reason: b.label || "Unavailable",
            who: t.name,
          })),
      );
    return [...salon, ...team].sort((a, b) => a.start - b.start);
  }, [day, member]);

  // the From–Until boxes show the selection (first start to last end when it's in pieces)
  const shownFrom = runs[0]?.start ?? null;
  const shownUntil = runs.length ? runs[runs.length - 1]!.end : null;
  const setRange = (part: "start" | "end", v: number) => {
    const next =
      part === "start"
        ? { start: v, end: shownUntil != null && shownUntil > v ? shownUntil : v + 60 }
        : { start: shownFrom != null && shownFrom < v ? shownFrom : Math.max(0, v - 60), end: v };
    setExact(next);
    setPicked([]);
    changed();
  };
  const fromOptions = [
    ...new Set([...timeOptions(), ...(shownFrom != null ? [shownFrom] : [])]),
  ].sort((a, b) => a - b);
  const untilOptions = [
    ...new Set([...timeOptions(), ...(shownUntil != null ? [shownUntil] : [])]),
  ].sort((a, b) => a - b);
  const isSel = (m: number) =>
    exact ? overlaps(m, m + step, exact.start, exact.end) : picked.includes(m);
  const team = (day?.team ?? []).filter((t) => t.working || t.id === who);

  const chip = (on: boolean) =>
    cn(
      "press rounded-full border px-3 py-1 text-[0.8rem]",
      on ? "border-foreground bg-foreground text-background" : "border-foreground/15",
    );
  const sel = "rounded-md border border-foreground/15 bg-background px-3 py-2 text-[0.9rem]";

  const renderPart = (p: (typeof DAY_PARTS)[number]) => {
    const list = (cells ?? []).filter((c) => c.m >= p.from && c.m < p.to);
    if (!list.length) return null;
    // collapse runs of the same non-pickable state into one line (lunch, not working, earlier)
    const rows: ({ cell: Cell } | { line: Cell; end: number })[] = [];
    for (const c of list) {
      const prev = rows[rows.length - 1];
      const flat = c.state === "break" || c.state === "off" || c.state === "past";
      if (
        flat &&
        prev &&
        "line" in prev &&
        prev.line.state === c.state &&
        prev.line.label === c.label &&
        prev.end === c.m
      )
        prev.end = c.m + step;
      else if (flat) rows.push({ line: c, end: c.m + step });
      else rows.push({ cell: c });
    }
    const free = partSlots(p.from, p.to).length;
    return (
      <section key={p.key} className="space-y-2">
        <div className="flex items-center gap-3">
          <span className="text-[0.68rem] font-medium uppercase tracking-[0.22em]">{p.label}</span>
          <span className="h-px flex-1 bg-foreground/10" />
          {free ? (
            <button
              type="button"
              onClick={() => quick(p.from, p.to)}
              className="text-[0.72rem] text-foreground/60 underline-offset-2 hover:underline"
            >
              {partSlots(p.from, p.to).every((m) => isSel(m)) ? "Clear" : "Select all"}
            </button>
          ) : null}
        </div>
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
          {rows.map((r) =>
            "line" in r ? (
              <div
                key={`l${r.line.m}`}
                className="col-span-full flex items-center gap-2 py-1 text-[0.72rem] text-foreground/50"
              >
                <span className="h-px flex-1 bg-foreground/10" />
                {r.line.label} · {minuteLabel(r.line.m)} – {minuteLabel(r.end)}
                <span className="h-px flex-1 bg-foreground/10" />
              </div>
            ) : (
              <button
                key={r.cell.m}
                type="button"
                data-slot={r.cell.m}
                disabled={!pickable(r.cell)}
                aria-pressed={isSel(r.cell.m)}
                onClick={() => tap(r.cell.m)}
                onPointerDown={(e) => onDown(r.cell.m, e)}
                className={cn(
                  "flex min-h-[3.1rem] select-none flex-col items-center justify-center rounded-md border px-1 py-1.5 text-[0.84rem] leading-tight transition-colors duration-100",
                  r.cell.state === "blocked" &&
                    "cursor-not-allowed border-dashed border-foreground/15 bg-foreground/[0.04] text-foreground/45",
                  pickable(r.cell) &&
                    !isSel(r.cell.m) &&
                    "border-foreground/15 bg-background hover:border-foreground/40",
                  isSel(r.cell.m) && "border-foreground bg-foreground text-background",
                )}
              >
                <span className="tabular-nums">{minuteLabel(r.cell.m)}</span>
                {r.cell.state === "booked" ? (
                  <span
                    className={cn(
                      "mt-0.5 flex items-center gap-1 text-[0.66rem] uppercase tracking-[0.12em]",
                      isSel(r.cell.m) ? "text-amber-300" : "text-amber-700",
                    )}
                  >
                    <span className="size-1.5 rounded-full bg-current" />
                    Booked
                  </span>
                ) : r.cell.state === "blocked" ? (
                  <span className="mt-0.5 max-w-full truncate text-[0.66rem]">{r.cell.label}</span>
                ) : null}
              </button>
            ),
          )}
        </div>
      </section>
    );
  };

  const summary = runs.length
    ? `${runs.map(runLabel).join(" and ")}${exact ? "" : ` · ${picked.length} slot${picked.length === 1 ? "" : "s"}`}`
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-[1.6rem] font-normal">Block time</DialogTitle>
          <DialogDescription>Guests immediately see this period as unavailable.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {day?.team && day.team.length ? (
            <div className="space-y-1.5">
              <p className="text-[0.72rem] uppercase tracking-[0.18em] text-foreground/55">Who</p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setWho("salon");
                    changed();
                  }}
                  className={chip(who === "salon")}
                >
                  Whole salon · all stylists
                </button>
                {team.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setWho(t.id);
                      setKind("block");
                      changed();
                    }}
                    className={chip(who === t.id)}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {!member ? (
              <div className="flex gap-1.5">
                {(["block", "break"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    className={chip(kind === k)}
                  >
                    {k === "block" ? "Block" : "One-day break"}
                  </button>
                ))}
              </div>
            ) : null}
            <input
              type="date"
              value={date}
              onChange={(e) => {
                if (!e.target.value) return;
                setDate(e.target.value);
                setPicked([]);
                setExact(null);
                changed();
              }}
              className={cn(sel, member ? "w-full" : "ml-auto min-w-[10.5rem] flex-1 sm:flex-none")}
              aria-label="Date"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="grid min-w-[14rem] flex-1 grid-cols-2 gap-2">
                <select
                  value={shownFrom ?? ""}
                  onChange={(e) => setRange("start", Number(e.target.value))}
                  className={sel}
                  aria-label="From"
                >
                  <option value="" disabled>
                    From
                  </option>
                  {fromOptions.map((m) => (
                    <option key={m} value={m}>
                      {minuteLabel(m)}
                    </option>
                  ))}
                </select>
                <select
                  value={shownUntil ?? ""}
                  onChange={(e) => setRange("end", Number(e.target.value))}
                  className={sel}
                  aria-label="Until"
                >
                  <option value="" disabled>
                    Until
                  </option>
                  {untilOptions.map((m) => (
                    <option key={m} value={m}>
                      {minuteLabel(m)}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => quick(0, 24 * 60)}
                className="rounded-full border border-foreground/15 px-3 py-1.5 text-[0.78rem]"
              >
                Whole day
              </button>
              {runs.length ? (
                <button
                  type="button"
                  onClick={() => setSel([])}
                  className="rounded-full border border-foreground/15 px-3 py-1.5 text-[0.78rem]"
                >
                  Clear
                </button>
              ) : null}
            </div>
            <p className="text-[0.76rem] text-foreground/55">
              {runs.length > 1
                ? `${runs.length} separate times picked on the slots below.`
                : "Set From and Until, or tap slots below (tap again to remove)."}
            </p>
          </div>

          <div
            className="space-y-4"
            style={{ touchAction: "pan-y" }}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={onUp}
            onPointerCancel={onUp}
          >
            {loadFailed ? (
              <p className="rounded-md border border-foreground/10 p-4 text-[0.85rem]">
                Couldn't load this day.{" "}
                <button type="button" className="underline" onClick={() => setReload((n) => n + 1)}>
                  Try again
                </button>
              </p>
            ) : !day ? (
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5" aria-busy="true">
                {Array.from({ length: 10 }, (_, i) => (
                  <div
                    key={i}
                    className="h-[3.1rem] animate-pulse rounded-md bg-foreground/[0.06]"
                  />
                ))}
              </div>
            ) : !cells ? (
              <p className="rounded-md border border-foreground/10 p-4 text-[0.85rem]">
                The salon is closed on {dateLabel(date)}
                {day.plan.note ? ` (${day.plan.note})` : ""}.
              </p>
            ) : member && !member.working ? (
              <p className="rounded-md border border-foreground/10 p-4 text-[0.85rem]">
                {member.name} isn't working on {dateLabel(date)}.
              </p>
            ) : (
              DAY_PARTS.map(renderPart)
            )}
          </div>

          {existing.length ? (
            <div className="space-y-1.5">
              <p className="text-[0.72rem] uppercase tracking-[0.18em] text-foreground/55">
                Already blocked this day
              </p>
              <ul className="divide-y divide-foreground/10 rounded-md border border-foreground/10">
                {existing.map((b) => (
                  <li key={b.id} className="flex items-center gap-3 px-3 py-2 text-[0.84rem]">
                    <span className="tabular-nums">
                      {minuteLabel(b.start)} – {minuteLabel(b.end)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-foreground/60">
                      {b.reason} · {b.who}
                    </span>
                    <button
                      type="button"
                      onClick={() => void unblock(b)}
                      className="text-[0.78rem] underline-offset-2 hover:underline"
                    >
                      Unblock
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-1.5">
            {BLOCK_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                className={chip(reason === r)}
              >
                {r}
              </button>
            ))}
          </div>

          <div
            className={cn(
              "rounded-md border px-3 py-2 text-[0.85rem]",
              runs.length
                ? "border-foreground/20"
                : "border-dashed border-foreground/15 text-foreground/55",
            )}
            aria-live="polite"
          >
            {runs.length ? (
              <>
                <span className="font-medium">Blocking {summary}</span>
                <span className="text-foreground/60">
                  {" "}
                  · {member ? member.name : "all stylists"}
                </span>
                {covered.length ? (
                  <p className="mt-1 text-amber-800">
                    ⚠ Covers {covered.length === 1 ? "a booking" : `${covered.length} bookings`} at{" "}
                    {covered.map(minuteLabel).join(", ")}. They stay booked.
                  </p>
                ) : null}
              </>
            ) : (
              "Nothing selected yet."
            )}
          </div>

          {clashes.length ? (
            <div className="rounded-md border border-amber-600/30 bg-amber-500/10 p-3 text-[0.85rem]">
              {clashes.length === 1 ? "There's a booking" : `There are ${clashes.length} bookings`}{" "}
              at {[...new Set(clashes)].map(minuteLabel).join(", ")} inside this time. They stay
              booked. Block anyway?
              <div className="mt-2 flex gap-2">
                <Action primary disabled={busy} onClick={() => void save(true)}>
                  {busy ? "Saving…" : "Block anyway"}
                </Action>
                <Action onClick={() => setClashes([])}>Change time</Action>
              </div>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-[0.85rem] text-destructive">
              {error}
            </p>
          ) : null}
          {!clashes.length ? (
            <div className="flex justify-end gap-2">
              <Action onClick={() => onOpenChange(false)}>Cancel</Action>
              <Action primary disabled={busy || !runs.length} onClick={() => void save()}>
                {busy ? "Saving…" : "Save"}
              </Action>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CloseDayDialog({
  open,
  onOpenChange,
  initialDate,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialDate?: string;
  onSaved?: () => void;
}) {
  const { pin } = useAdmin();
  const [date, setDate] = useState(initialDate ?? salonToday());
  const [reason, setReason] = useState(CLOSE_REASONS[0]!);
  const [existing, setExisting] = useState<AdminBooking[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setDate(initialDate ?? salonToday());
  }, [open, initialDate]);
  useEffect(() => {
    if (!open) return;
    setExisting(null);
    adminDay({ data: { pin, date } })
      .then((d) =>
        setExisting(d.bookings.filter((b) => b.status !== "cancelled" && b.status !== "no-show")),
      )
      .catch(() => setExisting([]));
  }, [open, date, pin]);

  const close = async () => {
    setBusy(true);
    try {
      // a salon closure (blocks every stylist); older databases fall back to a closed date
      const r = await adminAddClosure({
        data: { pin, kind: "days", start: date, end: date, reason },
      }).catch(() => null);
      if (!r?.ok)
        await adminSaveException({
          data: { pin, date, open: false, from: null, to: null, note: reason },
        });
      toast.success(`${dateLabel(date)} closed.`);
      onSaved?.();
      onOpenChange(false);
    } catch {
      toast.error("Couldn't close the day. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-[1.6rem] font-normal">Close a day</DialogTitle>
          <DialogDescription>
            Guests will see the day as closed and can't book it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <input
            type="date"
            value={date}
            min={salonToday()}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-md border border-foreground/15 px-3 py-2 text-[0.9rem]"
          />
          <div className="flex flex-wrap gap-1.5">
            {CLOSE_REASONS.map((r) => (
              <button
                key={r}
                onClick={() => setReason(r)}
                className={cn(
                  "press rounded-full border px-3 py-1 text-[0.78rem]",
                  reason === r
                    ? "border-foreground bg-foreground text-background"
                    : "border-foreground/15",
                )}
              >
                {r}
              </button>
            ))}
          </div>
          {existing === null ? (
            <p className="text-[0.82rem] text-muted-foreground">Checking bookings…</p>
          ) : existing.length ? (
            <div className="rounded-md border border-amber-600/30 bg-amber-500/10 p-3 text-[0.85rem]">
              {existing.length} booking{existing.length > 1 ? "s" : ""} on this day will stay booked
              — contact or reschedule them:
              <ul className="mt-1 list-disc pl-5">
                {existing.map((b) => (
                  <li key={b.reference}>
                    {minuteLabel(b.time)} · {b.customer.name}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-[0.82rem] text-muted-foreground">No bookings on this day.</p>
          )}
          <div className="flex justify-end gap-2">
            <Action onClick={() => onOpenChange(false)}>Cancel</Action>
            <Action danger disabled={busy} onClick={() => void close()}>
              {busy ? "Closing…" : `Close ${dateLabel(date)}`}
            </Action>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { X };
