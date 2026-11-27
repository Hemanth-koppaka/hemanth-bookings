CREATE OR REPLACE FUNCTION public.sync_customer_booking_contact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.bookings
  SET customer = COALESCE(customer, '{}'::jsonb) || jsonb_build_object('name', NEW.name, 'phone', NEW.phone, 'email', NEW.email)
  WHERE customer_id = NEW.id
    AND (customer->>'name' IS DISTINCT FROM NEW.name OR customer->>'phone' IS DISTINCT FROM NEW.phone OR customer->>'email' IS DISTINCT FROM NEW.email);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_customer_booking_contact() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER sync_customer_booking_contact
AFTER UPDATE OF name, phone, email ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.sync_customer_booking_contact();