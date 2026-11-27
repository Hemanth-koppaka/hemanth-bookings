import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { findService, type Audience, type Service } from "./salon";
import { createBooking, findMyBooking, findMyBookings, updateMyBooking } from "./salon.functions";

/** How a booking proves it's the guest's: its manage key, or the phone it was booked with. */
export const auth = (b: { token?: string | undefined; customer: { phone: string } }) =>
  b.token ? { token: b.token } : { phone: b.customer.phone };

export type BookingStatus = "confirmed" | "cancelled";

export type Customer = {
  name: string;
  phone: string;
  email: string;
  notes?: string;
  /** Agreed to booking messages (confirmation, changes, reminders) on WhatsApp/SMS. */
  consent?: boolean;
  /** Storage paths of reference photos (server-set; removed after the visit). */
  photos?: string[];
};

export type RefPhoto = { path: string; thumb: string; proof?: string };

export type Draft = {
  audience: Audience | null;
  serviceIds: string[];
  date: string | null; // ISO yyyy-mm-dd
  time: number | null; // minutes from midnight
  customer: Customer | null;
  /** Identifies this booking's uploads before it has a reference. */
  draftId?: string;
  /** Optional reference photos already uploaded (deleted after the visit). */
  photos?: RefPhoto[];
  /** Chosen stylist id; null/absent = any available stylist. */
  staffId?: string | null;
  /** The services category the guest was last browsing (by id), restored on return. */
  lastCategoryId?: string;
  /** Services changed after a time was chosen: the time must be checked again. */
  timeStale?: boolean;
};

export type Booking = {
  changes?: { id: string; title: string; body: string }[];
  reference: string;
  audience: Audience;
  serviceIds: string[];
  date: string;
  time: number;
  customer: Customer;
  status: BookingStatus;
  createdAt: string;
  /** Manage key from a lookup by booking ID or phone (the phone isn't sent back). */
  token?: string;
  /** Found by phone number only: view-only until the booking ID is entered. */
  readOnly?: boolean;
  /** From the salon: a finished visit the guest hasn't rated yet. */
  rateable?: boolean;
  /** Booked details with current prices until completion; completed prices are retained. */
  snapshot?: BookingSnapshot | undefined;
  /** The stylist assigned when the booking was confirmed. */
  stylist?: string | null | undefined;
  staffId?: string | null | undefined;
  /** The guest picked this stylist themselves (not "any available"). */
  stylistChosen?: boolean;
};

export type BookingSnapshot = {
  services: { id?: string; name: string; price: number; minutes: number }[];
  minutes: number;
  price: number;
};

const EMPTY: Draft = {
  audience: null,
  serviceIds: [],
  date: null,
  time: null,
  customer: null,
};

const DRAFT_KEY = "hbb.draft.v2";
const BOOKINGS_KEY = "hbb.bookings.v2";

type Ctx = {
  draft: Draft;
  update: (patch: Partial<Draft> | ((d: Draft) => Partial<Draft>)) => void;
  setAudience: (a: Audience) => void;
  toggleService: (id: string) => void;
  removeService: (id: string) => void;
  resetDraft: () => void;
  selected: Service[];
  totalSlots: number;
  /** Service time of the selection, in minutes. */
  totalMinutes: number;
  totalPrice: number;
  hasFromPricing: boolean;
  bookings: Booking[];
  commitBooking: (allowRepeat?: boolean) => Promise<{ booking: Booking } | { error: string }>;
  /** Looks up by booking ID or by the mobile number used to book. null = couldn't reach the salon. */
  findBookings: (reference: string, phone: string) => Promise<Booking[] | null>;
  cancelBooking: (reference: string) => Promise<ChangeResult>;
  /** Moves a booking and/or changes its services (serviceIds omitted = keep them). */
  rescheduleBooking: (
    reference: string,
    date: string,
    time: number,
    staffId?: string | null,
    serviceIds?: string[],
  ) => Promise<ChangeResult>;
  hydrated: boolean;
};

export type ChangeResult = { ok: true } | { ok: false; error: string };

const OFFLINE = "We couldn't reach the salon. Check your connection and try again.";

const BookingContext = createContext<Ctx | null>(null);

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function BookingProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.removeItem("hbb.draft.v1");
      window.localStorage.removeItem("hbb.bookings.v1");
    } catch {
      /* Browser storage is optional. */
    }
    setDraft(read<Draft>(DRAFT_KEY, EMPTY));
    setBookings(read<Booking[]>(BOOKINGS_KEY, []));
    setHydrated(true);
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const saved = read<Booking[]>(BOOKINGS_KEY, []);
      const updates = await Promise.all(
        saved
          .filter((b) => !b.readOnly && (b.token || !b.customer.phone.includes("•")))
          .map(async (b) => {
            const result = await findMyBooking({
              data: { reference: b.reference, ...auth(b) },
            }).catch(() => null);
            return result?.booking ? { reference: b.reference, booking: result.booking } : null;
          }),
      );
      if (!active) return;
      setBookings((current) =>
        current.map((b) => {
          const updated = updates.find((u) => u?.reference === b.reference)?.booking;
          return updated
            ? {
                ...b,
                customer: updated.customer,
                staffId: updated.staffId,
                stylist: updated.stylist,
                stylistChosen: updated.stylistChosen,
                date: updated.date,
                time: updated.time,
                status: updated.status,
                rateable: updated.rateable,
                changes: updated.changes,
                snapshot: updated.snapshot ?? undefined,
              }
            : b;
        }),
      );
    };
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    void refresh();
    const timer = window.setInterval(visible, 30_000);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [draft, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(BOOKINGS_KEY, JSON.stringify(bookings));
  }, [bookings, hydrated]);

  const value = useMemo<Ctx>(() => {
    const selected: Service[] = draft.audience
      ? draft.serviceIds
          .map((id) => findService(draft.audience as Audience, id))
          .filter((x): x is Service => Boolean(x))
      : [];

    const totalMinutes = selected.reduce((n, s) => n + (s.minutes ?? s.slots * 30), 0);
    const totalSlots = Math.ceil(totalMinutes / 30);
    const totalPrice = selected.reduce((n, s) => n + s.price, 0);
    const hasFromPricing = selected.some((s) => s.from);

    return {
      draft,
      hydrated,
      selected,
      totalSlots,
      totalMinutes,
      totalPrice,
      hasFromPricing,
      bookings,
      update: (patch) => {
        if (typeof patch !== "function" && draft.audience) {
          if (patch.customer || patch.time != null) {
            window.__lovableEvents?.track?.("project.booking_step_completed", {
              audience: draft.audience,
              stage: patch.customer ? "details" : "time",
            });
          }
        }
        setDraft((d) => ({ ...d, ...(typeof patch === "function" ? patch(d) : patch) }));
      },
      setAudience: (a) => {
        window.__lovableEvents?.track?.("project.booking_step_completed", {
          audience: a,
          stage: "menu",
        });
        setDraft((d) =>
          d.audience === a
            ? { ...d, audience: a }
            : { ...EMPTY, audience: a, customer: d.customer },
        );
      },
      toggleService: (id) => {
        if (draft.audience && !draft.serviceIds.includes(id) && findService(draft.audience, id)) {
          window.__lovableEvents?.track?.("project.service_selected", {
            audience: draft.audience,
            service_id: id,
          });
        }
        setDraft((d) => ({
          ...d,
          // one entry per service (by id), never duplicates
          serviceIds: d.serviceIds.includes(id)
            ? d.serviceIds.filter((x) => x !== id)
            : [...d.serviceIds, id],
          // a chosen time is kept but re-checked on the time step (the length changed)
          ...(d.time != null ? { timeStale: true } : {}),
        }));
      },
      removeService: (id) =>
        setDraft((d) => ({
          ...d,
          serviceIds: d.serviceIds.filter((x) => x !== id),
          ...(d.time != null ? { timeStale: true } : {}),
        })),
      resetDraft: () => setDraft(EMPTY),
      commitBooking: async (allowRepeat = false) => {
        if (!draft.audience || !draft.date || draft.time == null || !draft.customer)
          return { error: "Your booking is incomplete." };
        const booking: Booking = {
          reference: "",
          audience: draft.audience,
          serviceIds: draft.serviceIds,
          date: draft.date,
          time: draft.time,
          // remember that this booking carries reference photos ("Your look")
          customer: draft.photos?.length
            ? { ...draft.customer, photos: draft.photos.map((x) => x.path) }
            : draft.customer,
          status: "confirmed",
          createdAt: new Date().toISOString(),
        };
        try {
          const { reference: _unused, customer: _c, ...payload } = booking;
          const res = await createBooking({
            data: {
              ...payload,
              customer: {
                name: booking.customer.name,
                phone: booking.customer.phone,
                email: booking.customer.email ?? "",
                ...(booking.customer.notes ? { notes: booking.customer.notes } : {}),
              },
              consent: booking.customer.consent !== false,
              allowRepeat,
              ...(draft.staffId ? { staffId: draft.staffId } : {}),
              ...(draft.photos?.length
                ? {
                    photos: draft.photos.map(({ path, proof }) => ({ path, proof })),
                  }
                : {}),
            },
          });
          if (!res.ok) return { error: res.error };
          booking.reference = res.reference; // issued by the salon (random, e.g. HB-7KQ2MX)
          if ("snapshot" in res && res.snapshot) booking.snapshot = res.snapshot;
          if ("stylist" in res) booking.stylist = res.stylist ?? null;
          booking.stylistChosen = Boolean(draft.staffId);
        } catch {
          return { error: "We couldn't reach the salon. Check your connection and try again." };
        }
        setBookings((b) => [booking, ...b]);
        window.__lovableEvents?.track?.("project.booking_completed", {
          audience: booking.audience,
          service_count: booking.serviceIds.length,
        });
        return { booking };
      },
      findBookings: async (reference, phone) => {
        try {
          const { bookings: list } = await findMyBookings({ data: { reference, phone } });
          const found: Booking[] = list.map((r) => ({
            reference: r.reference,
            audience: r.audience,
            serviceIds: r.serviceIds,
            date: r.date,
            time: r.time,
            customer: r.customer,
            status: r.status,
            createdAt: r.createdAt,
            staffId: r.staffId,
            stylist: r.stylist,
            stylistChosen: r.stylistChosen,
            ...("token" in r && r.token ? { token: r.token } : {}),
            ...("readOnly" in r && r.readOnly ? { readOnly: true } : {}),
            rateable: r.rateable,
            ...(r.snapshot ? { snapshot: r.snapshot } : {}),
          }));
          const refs = new Set(found.map((f) => f.reference));
          setBookings((b) => {
            // a booking made (or unlocked) on this device keeps its full access
            const merged = found.map((f) => {
              // view-only results carry a hidden ID: match this device's own copy by its appointment
              const same = (x: Booking) =>
                f.readOnly
                  ? x.date === f.date &&
                    x.time === f.time &&
                    x.reference.slice(0, 5) === f.reference.slice(0, 5)
                  : x.reference === f.reference;
              const mine = b.find((x) => same(x) && !x.readOnly);
              const canManage = mine && (mine.token || !mine.customer.phone.includes("•"));
              if (!canManage) return f;
              const { readOnly: _ro, ...rest } = f;
              return {
                ...rest,
                reference: mine.reference,
                customer: { ...f.customer, phone: mine.customer.phone },
                ...(mine.token ? { token: mine.token } : {}),
              };
            });
            const kept = new Set([...refs, ...merged.map((m) => m.reference)]);
            return [...merged, ...b.filter((x) => !kept.has(x.reference))];
          });
          return found;
        } catch {
          return null;
        }
      },
      // Both changes are confirmed by the salon's server before the screen updates.
      cancelBooking: async (reference) => {
        const bk = bookings.find((x) => x.reference === reference);
        if (!bk) return { ok: false, error: "Booking not found on this device." };
        const r = await updateMyBooking({
          data: { reference, ...auth(bk), action: "cancel" },
        }).catch(() => null);
        if (!r) return { ok: false, error: OFFLINE };
        if (!r.ok)
          return { ok: false, error: ("error" in r && r.error) || "Couldn't cancel this booking." };
        setBookings((b) =>
          b.map((x) => (x.reference === reference ? { ...x, status: "cancelled" as const } : x)),
        );
        return { ok: true };
      },
      rescheduleBooking: async (reference, date, time, staffId, serviceIds) => {
        const bk = bookings.find((x) => x.reference === reference);
        if (!bk) return { ok: false, error: "Booking not found on this device." };
        const r = await updateMyBooking({
          data: {
            reference,
            ...auth(bk),
            action: "reschedule",
            date,
            time,
            staffId,
            ...(serviceIds ? { serviceIds } : {}),
          },
        }).catch(() => null);
        if (!r) return { ok: false, error: OFFLINE };
        if (!r.ok)
          return { ok: false, error: ("error" in r && r.error) || "Couldn't move this booking." };
        const updated = await findMyBooking({ data: { reference, ...auth(bk) } }).catch(() => null);
        setBookings((b) =>
          b.map((x) =>
            x.reference === reference
              ? {
                  ...x,
                  date,
                  time,
                  ...(serviceIds ? { serviceIds } : {}),
                  ...(updated?.booking
                    ? {
                        customer: updated.booking.customer,
                        staffId: updated.booking.staffId,
                        stylist: updated.booking.stylist,
                        stylistChosen: updated.booking.stylistChosen,
                        serviceIds: updated.booking.serviceIds,
                        snapshot: updated.booking.snapshot ?? undefined,
                      }
                    : {}),
                }
              : x,
          ),
        );
        return { ok: true };
      },
    };
  }, [draft, bookings, hydrated]);

  return <BookingContext.Provider value={value}>{children}</BookingContext.Provider>;
}

export function useBooking() {
  const ctx = useContext(BookingContext);
  if (!ctx) throw new Error("useBooking must be used inside BookingProvider");
  return ctx;
}

export function servicesOf(booking: Booking): Service[] {
  return booking.serviceIds
    .map((id) => findService(booking.audience, id))
    .filter((x): x is Service => Boolean(x));
}
