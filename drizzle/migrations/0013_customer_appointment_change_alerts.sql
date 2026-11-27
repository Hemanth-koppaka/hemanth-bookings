CREATE TABLE public.appointment_change_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_reference text NOT NULL, event_type text NOT NULL, booking_snapshot jsonb NOT NULL, previous jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz
);
GRANT ALL ON public.appointment_change_events TO service_role;
ALTER TABLE public.appointment_change_events ENABLE ROW LEVEL SECURITY;
CREATE INDEX appointment_change_events_pending ON public.appointment_change_events(created_at) WHERE processed_at IS NULL;
CREATE TABLE public.appointment_change_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES public.appointment_change_events(id) ON DELETE CASCADE, subscription jsonb NOT NULL, status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), claimed_until timestamptz, UNIQUE(event_id,subscription)
);
GRANT ALL ON public.appointment_change_deliveries TO service_role;
ALTER TABLE public.appointment_change_deliveries ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.capture_appointment_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.status = 'cancelled' OR coalesce(NEW.meta->>'status','') IN ('cancelled','completed','no-show','archived') OR coalesce(OLD.meta->>'status','') IN ('completed','no-show','archived') THEN RETURN NEW; END IF;
 IF (NEW.date::text::date + make_interval(mins=>NEW.time)) AT TIME ZONE 'Asia/Kolkata' <= now() THEN RETURN NEW; END IF;
 IF NEW.price_total IS DISTINCT FROM OLD.price_total THEN
 INSERT INTO public.appointment_change_events(booking_reference,event_type,booking_snapshot,previous) VALUES(NEW.reference,'BOOKING_PRICE_CHANGED',to_jsonb(NEW),jsonb_build_object('price',OLD.price_total));
 END IF;
 IF NEW.date IS DISTINCT FROM OLD.date OR NEW.time IS DISTINCT FROM OLD.time THEN
 INSERT INTO public.appointment_change_events(booking_reference,event_type,booking_snapshot,previous) VALUES(NEW.reference,'BOOKING_RESCHEDULED',to_jsonb(NEW),jsonb_build_object('date',OLD.date,'time',OLD.time));
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.capture_appointment_change() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.capture_appointment_change() TO service_role;
CREATE TRIGGER bookings_capture_customer_changes AFTER UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.capture_appointment_change();
CREATE OR REPLACE FUNCTION public.claim_appointment_change_deliveries() RETURNS SETOF public.appointment_change_deliveries LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 UPDATE public.appointment_change_deliveries SET claimed_until=now()+interval '2 minutes', attempts=attempts+1 WHERE id IN (SELECT id FROM public.appointment_change_deliveries WHERE status='pending' AND next_attempt_at<=now() AND (claimed_until IS NULL OR claimed_until<now()) ORDER BY next_attempt_at LIMIT 30 FOR UPDATE SKIP LOCKED) RETURNING *;
$$;
REVOKE ALL ON FUNCTION public.claim_appointment_change_deliveries() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_appointment_change_deliveries() TO service_role;