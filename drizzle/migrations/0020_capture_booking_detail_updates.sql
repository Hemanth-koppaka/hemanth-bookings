CREATE OR REPLACE FUNCTION public.capture_appointment_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF NEW.status = 'cancelled' OR coalesce(NEW.meta->>'status','') IN ('cancelled','completed','no-show','archived') OR coalesce(OLD.meta->>'status','') IN ('completed','no-show','archived') THEN RETURN NEW; END IF;
 IF (NEW.date::timestamp + make_interval(mins=>NEW.time)) AT TIME ZONE 'Asia/Kolkata' <= now() THEN RETURN NEW; END IF;
 IF NEW.price_total IS DISTINCT FROM OLD.price_total THEN
 INSERT INTO public.appointment_change_events(booking_reference,event_type,booking_snapshot,previous) VALUES(NEW.reference,'BOOKING_PRICE_CHANGED',to_jsonb(NEW),jsonb_build_object('price',OLD.price_total));
 END IF;
 IF NEW.date IS DISTINCT FROM OLD.date OR NEW.time IS DISTINCT FROM OLD.time THEN
 INSERT INTO public.appointment_change_events(booking_reference,event_type,booking_snapshot,previous) VALUES(NEW.reference,'BOOKING_RESCHEDULED',to_jsonb(NEW),jsonb_build_object('date',OLD.date,'time',OLD.time,'staffId',OLD.staff_id));
 ELSIF NEW.staff_id IS DISTINCT FROM OLD.staff_id OR NEW.customer->>'name' IS DISTINCT FROM OLD.customer->>'name' OR NEW.customer->>'phone' IS DISTINCT FROM OLD.customer->>'phone' OR NEW.customer->>'email' IS DISTINCT FROM OLD.customer->>'email' OR NEW.meta->>'status' IS DISTINCT FROM OLD.meta->>'status' THEN
 INSERT INTO public.appointment_change_events(booking_reference,event_type,booking_snapshot,previous) VALUES(NEW.reference,'BOOKING_UPDATED',to_jsonb(NEW),jsonb_build_object('staffId',OLD.staff_id));
 END IF;
 RETURN NEW;
END;
$$;