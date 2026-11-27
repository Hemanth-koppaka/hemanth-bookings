CREATE OR REPLACE FUNCTION public.sync_booking_contact_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR NEW.customer_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.customer->>'name' IS NOT DISTINCT FROM OLD.customer->>'name'
     AND NEW.customer->>'phone' IS NOT DISTINCT FROM OLD.customer->>'phone'
     AND NEW.customer->>'email' IS NOT DISTINCT FROM OLD.customer->>'email' THEN RETURN NEW; END IF;
  -- Shared phone records may represent distinct guests; never rename another guest.
  IF EXISTS (SELECT 1 FROM public.bookings b WHERE b.customer_id = NEW.customer_id AND b.reference <> NEW.reference
     AND (b.customer->>'name' IS DISTINCT FROM OLD.customer->>'name' OR b.customer->>'phone' IS DISTINCT FROM OLD.customer->>'phone')) THEN RETURN NEW; END IF;
  UPDATE public.customers SET name = NEW.customer->>'name', phone = COALESCE(NEW.customer->>'phone', ''),
    phone_key = right(regexp_replace(COALESCE(NEW.customer->>'phone', ''), '[^0-9]', '', 'g'), 10),
    email = COALESCE(NEW.customer->>'email', '') WHERE id = NEW.customer_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_booking_contact_profile() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER sync_booking_contact_profile AFTER UPDATE OF customer ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.sync_booking_contact_profile();