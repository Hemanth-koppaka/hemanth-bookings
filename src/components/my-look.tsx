// "Your look": the reference photos a guest attached to their booking, ready
// to hand to the stylist full screen, with no gallery to scroll through.
// On the home page it appears only from 1 hour before the appointment until
// the slot ends; in Manage booking it is there for that booking until the slot
// ends. The photos stay private: the salon's server hands out short-lived
// links only to the guest who made the booking, and deletes them after the visit.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, ImagePlus, Loader2, Maximize2, X } from "lucide-react";
import { auth, useBooking, type Booking } from "@/lib/booking-store";
import { addBookingPhoto, myLookPhotos, removeBookingPhoto } from "@/lib/salon.functions";
import { loadImageFile, shrinkImage } from "@/lib/image";
import { minuteLabel } from "@/lib/salon";
import { cn, haptic } from "@/lib/utils";

const MAX_PHOTOS = 3;

export type LookPhoto = { id: string; full: string; thumb: string };

/** Salon time now (UTC+5:30): ISO day and minutes since midnight. */
function salonNow() {
  const n = new Date(Date.now() + 330 * 60_000);
  return { iso: n.toISOString().slice(0, 10), minute: n.getUTCHours() * 60 + n.getUTCMinutes() };
}

const minutesOf = (b: Booking) => b.snapshot?.minutes ?? Math.max(30, b.serviceIds.length * 30);
export const hasLook = (b: Booking) =>
  b.status !== "cancelled" && (b.customer.photos?.length ?? 0) > 0;

type When = { date: string; time: number; minutes: number };

/** Where an appointment stands: "later" (more than 1 hr away), "soon", "now" or "over". */
function phaseOf(w: When): "later" | "soon" | "now" | "over" {
  const { iso, minute } = salonNow();
  const end = w.time + w.minutes;
  if (w.date < iso || (w.date === iso && minute >= end)) return "over";
  if (w.date > iso || minute < w.time - 60) return "later";
  return minute < w.time ? "soon" : "now";
}

export function lookPhase(b: Booking) {
  return b.status === "cancelled"
    ? "over"
    : phaseOf({ date: b.date, time: b.time, minutes: minutesOf(b) });
}

/** Re-renders every 30 seconds (so the row appears and vanishes on time). */
function useTick(ms = 30_000) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => set((x) => x + 1), ms);
    return () => window.clearInterval(t);
  }, [ms]);
}

/** The booking's photos as short-lived links (only while its slot hasn't ended). */
function useLookPhotos(b: Booking | null) {
  const [state, setState] = useState<{
    ref: string;
    photos: LookPhoto[];
    loading: boolean;
    when?: When;
  }>({ ref: "", photos: [], loading: false });
  const ref = b?.reference ?? "";
  useEffect(() => {
    if (!b || !ref) return;
    let live = true;
    setState({ ref, photos: [], loading: true });
    myLookPhotos({ data: { reference: ref, ...auth(b) } })
      .then(
        (r) =>
          live &&
          setState({
            ref,
            loading: false,
            photos: r.urls.map((u, i) => ({ id: `${ref}-${i}`, full: u, thumb: u })),
            // the salon's own date and time (follows any reschedule)
            ...("date" in r && r.date
              ? { when: { date: r.date, time: r.time!, minutes: r.minutes! } }
              : {}),
          }),
      )
      .catch(() => live && setState({ ref, photos: [], loading: false }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);
  return state.ref === ref
    ? state
    : { photos: [] as LookPhoto[], loading: Boolean(b), when: undefined };
}

/** Full-screen, distraction-free viewer to hand the phone to the stylist. */
export function LookViewer({
  photos,
  start = 0,
  onClose,
}: {
  photos: LookPhoto[];
  start?: number;
  onClose: () => void;
}) {
  const [i, setI] = useState(start);
  const touch = useRef<number | null>(null);
  const n = photos.length;
  const go = (d: number) => n > 1 && setI((x) => (x + d + n) % n);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // keep the screen awake while the stylist looks
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> };
    };
    nav.wakeLock
      ?.request("screen")
      .then((l) => (lock = l))
      .catch(() => {});
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      void lock?.release().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const p = photos[Math.min(i, n - 1)];
  if (!p) return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal
      aria-label="Your look"
      className="fixed inset-0 z-[80] flex flex-col bg-black text-white"
      onTouchStart={(e) => (touch.current = e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => {
        const x0 = touch.current;
        const x1 = e.changedTouches[0]?.clientX;
        touch.current = null;
        if (x0 == null || x1 == null || Math.abs(x1 - x0) < 40) return;
        go(x1 < x0 ? 1 : -1);
      }}
    >
      <div className="flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
        <span className="text-[0.66rem] uppercase tracking-[0.3em] text-white/70">
          Your look{n > 1 ? ` · ${i + 1} / ${n}` : ""}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="press flex h-11 w-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
        >
          <X className="h-5 w-5" strokeWidth={1.5} />
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2">
        <img
          key={p.id}
          src={p.full}
          alt={`Look ${i + 1}`}
          className="fade-rise max-h-full max-w-full object-contain"
          draggable={false}
        />
        {n > 1 ? (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Previous photo"
              className="press absolute left-3 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
            >
              <ChevronLeft className="h-5 w-5" strokeWidth={1.5} />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Next photo"
              className="press absolute right-3 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
            >
              <ChevronRight className="h-5 w-5" strokeWidth={1.5} />
            </button>
          </>
        ) : null}
      </div>
      {n > 1 ? (
        <div className="flex justify-center gap-2 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {photos.map((x, k) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setI(k)}
              aria-label={`Photo ${k + 1}`}
              className={cn(
                "h-12 w-12 overflow-hidden rounded-md border-2",
                k === i ? "border-white" : "border-transparent opacity-60",
              )}
            >
              <img src={x.thumb} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      ) : (
        <div className="pb-[max(1.25rem,env(safe-area-inset-bottom))]" />
      )}
    </div>,
    document.body,
  );
}

function LookRow({
  photos,
  loading,
  title,
  sub,
  className,
  onOpen,
  dark,
}: {
  photos: LookPhoto[];
  loading: boolean;
  title: string;
  sub: string;
  className?: string | undefined;
  onOpen: () => void;
  /** on the dark confirmation screen */
  dark?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!photos.length}
      className={cn(
        "press fade-rise flex min-h-14 w-full items-center gap-3 rounded-sm border py-2 pl-3 pr-4 text-left disabled:opacity-70",
        dark
          ? "border-[#E8E1D8]/20 bg-white/[0.03] text-[#E8E1D8]"
          : "border-foreground/12 bg-card/70",
        className,
      )}
    >
      <span className="flex shrink-0 -space-x-3">
        {loading && !photos.length ? (
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-champagne/25 text-bronze">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
          </span>
        ) : (
          photos.map((p) => (
            <img
              key={p.id}
              src={p.thumb}
              alt=""
              className="h-10 w-10 rounded-md border-2 border-background object-cover"
            />
          ))
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.95rem] leading-tight">{title}</span>
        <span className="block truncate text-[0.75rem] text-muted-foreground">{sub}</span>
      </span>
      <Maximize2 className="h-4 w-4 shrink-0 text-bronze" strokeWidth={1.5} />
    </button>
  );
}

/**
 * Home page: the guest's look, only from 1 hour before their appointment until
 * the slot ends, and only for a booking that has reference photos.
 */
export function UpcomingLook({ className }: { className?: string }) {
  const { bookings, hydrated } = useBooking();
  useTick();
  const [open, setOpen] = useState(false);
  const b = hydrated
    ? (bookings
        .filter((x) => hasLook(x) && ["soon", "now"].includes(lookPhase(x)))
        .sort((x, y) =>
          (x.date + String(x.time).padStart(4, "0")).localeCompare(
            y.date + String(y.time).padStart(4, "0"),
          ),
        )[0] ?? null)
    : null;
  const { photos, loading, when } = useLookPhotos(b);
  if (!b) return null;
  if (!loading && !photos.length) return null; // cancelled, removed, or the visit is over
  // the salon's record wins (e.g. the appointment was moved by the salon)
  if (when && !["soon", "now"].includes(phaseOf(when))) return null;
  return (
    <>
      <LookRow
        photos={photos}
        loading={loading}
        title="Your look"
        sub={`For your ${minuteLabel(when?.time ?? b.time)} appointment · tap to show your stylist`}
        className={className}
        onOpen={() => setOpen(true)}
      />
      {open && photos.length ? <LookViewer photos={photos} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/**
 * Manage booking: the booking's look. Until the appointment starts the guest can
 * add photos (up to 3 in all) or remove them; after that it's view-only until
 * the slot ends, like the home page.
 */
export function BookingLook({
  booking,
  className,
  tone = "light",
}: {
  booking: Booking;
  className?: string;
  /** dark = cinematic confirmation screen, light = ivory pages */
  tone?: "dark" | "light";
}) {
  const dark = tone === "dark";
  useTick();
  const [open, setOpen] = useState<number | null>(null);
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<{
    photos: (LookPhoto & { name: string })[];
    editable: boolean;
    loading: boolean;
  }>({ photos: [], editable: false, loading: true });
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const phase = lookPhase(booking);
  const live = booking.status !== "cancelled" && phase !== "over";

  useEffect(() => {
    if (!live) return;
    let on = true;
    myLookPhotos({ data: { reference: booking.reference, ...auth(booking) } })
      .then((r) => {
        if (!on) return;
        const names = "names" in r && r.names ? r.names : [];
        setState({
          loading: false,
          editable: Boolean("editable" in r && r.editable) && !booking.readOnly,
          photos: r.urls.map((u, i) => ({
            id: names[i] ?? `${booking.reference}-${i}`,
            name: names[i] ?? "",
            full: u,
            thumb: u,
          })),
        });
      })
      .catch(() => on && setState((s) => ({ ...s, loading: false })));
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking.reference, live, reload]);

  if (!live) return null;
  const { photos, editable, loading } = state;
  if (!editable && !loading && !photos.length) return null;
  if (!editable && (loading || photos.length))
    return (
      <>
        <LookRow
          photos={photos}
          loading={loading}
          title="Your look"
          sub="Your reference photos · tap to show your stylist"
          className={className}
          dark={dark}
          onOpen={() => setOpen(0)}
        />
        {open != null && photos.length ? (
          <LookViewer photos={photos} start={open} onClose={() => setOpen(null)} />
        ) : null}
      </>
    );

  const room = MAX_PHOTOS - photos.length - busy;
  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setError("");
    const picked = Array.from(files).slice(0, Math.max(0, room));
    if (files.length > picked.length) setError(`You can add up to ${MAX_PHOTOS} photos.`);
    setBusy((n) => n + picked.length);
    for (const file of picked) {
      try {
        const img = await loadImageFile(file);
        const r = await addBookingPhoto({
          data: {
            reference: booking.reference,
            ...auth(booking),
            dataUrl: shrinkImage(img, 1600, 0.82),
          },
        });
        if (!r.ok) throw new Error(r.error);
        haptic();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't add that photo.");
      } finally {
        setBusy((n) => n - 1);
      }
    }
    if (input.current) input.current.value = "";
    setReload((n) => n + 1);
  };
  const remove = async (p: { name: string }) => {
    setError("");
    setState((s) => ({ ...s, photos: s.photos.filter((x) => x.name !== p.name) }));
    const r = await removeBookingPhoto({
      data: { reference: booking.reference, ...auth(booking), name: p.name },
    }).catch(() => null);
    if (!r?.ok) setError((r && "error" in r && r.error) || "Couldn't remove that photo.");
    setReload((n) => n + 1);
  };

  return (
    <section
      className={cn(
        "rounded-sm border p-4",
        dark
          ? "border-[#E8E1D8]/20 bg-white/[0.03] text-[#E8E1D8]"
          : "border-foreground/12 bg-card/70",
        className,
      )}
    >
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="text-[0.95rem]">Your look</span>
        <span
          className={cn(
            "text-[0.75rem] tabular-nums",
            dark ? "text-[#E8E1D8]/55" : "text-muted-foreground",
          )}
        >
          {photos.length}/{MAX_PHOTOS}
        </span>
      </div>
      <p
        className={cn(
          "mb-3 text-[0.8rem] leading-relaxed",
          dark ? "text-[#E8E1D8]/65" : "text-muted-foreground",
        )}
      >
        {photos.length
          ? "Tap a photo to show your stylist. You can add or remove photos until your appointment starts."
          : "Add photos of a look you love (up to 3). Only your stylist sees them, and they're deleted after your visit."}
      </p>
      <div className="flex flex-wrap gap-3">
        {photos.map((p, i) => (
          <div
            key={p.id}
            className="pop-in relative h-20 w-20 overflow-hidden rounded-md border border-hairline bg-muted"
          >
            <button
              type="button"
              onClick={() => setOpen(i)}
              aria-label="Show this photo full screen"
              className="h-full w-full"
            >
              <img
                src={p.thumb}
                alt="Your reference photo"
                className="h-full w-full object-cover"
              />
            </button>
            <button
              type="button"
              onClick={() => void remove(p)}
              aria-label="Remove photo"
              className="press absolute top-1 right-1 flex h-7 w-7 items-center justify-center rounded-full bg-ink/75 text-ivory backdrop-blur-sm hover:bg-ink"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </div>
        ))}
        {loading
          ? null
          : Array.from({ length: busy }, (_, i) => (
              <div
                key={`busy-${i}`}
                className={cn(
                  "flex h-20 w-20 items-center justify-center rounded-md border",
                  dark ? "border-[#E8E1D8]/20 bg-white/[0.04]" : "border-hairline bg-card",
                )}
              >
                <Loader2
                  className="h-5 w-5 animate-spin text-bronze"
                  strokeWidth={1.5}
                  aria-label="Uploading"
                />
              </div>
            ))}
        {loading ? (
          <div className="flex h-20 w-20 items-center justify-center rounded-md bg-champagne/25 text-bronze">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
          </div>
        ) : room > 0 ? (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className={cn(
              "press flex h-20 w-20 flex-col items-center justify-center gap-1.5 rounded-md border border-dashed",
              dark
                ? "border-[#E8E1D8]/35 bg-transparent text-[#E8E1D8]/80 hover:border-[#C9A96E] hover:text-[#C9A96E]"
                : "border-foreground/25 bg-card text-foreground/70 hover:border-bronze hover:text-bronze",
            )}
          >
            <ImagePlus className="h-5 w-5" strokeWidth={1.25} />
            <span className="text-[0.66rem] uppercase tracking-[0.16em]">Add photo</span>
          </button>
        ) : null}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => void add(e.target.files)}
      />
      {error ? (
        <p key={error} role="alert" className="shake mt-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {open != null && photos.length ? (
        <LookViewer
          photos={photos}
          start={Math.min(open, photos.length - 1)}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </section>
  );
}
