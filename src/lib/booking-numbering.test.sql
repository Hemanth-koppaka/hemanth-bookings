-- Run through the authorized database query tool. Everything rolls back.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('bk-admin-booking-number'));
DO $$
DECLARE first_no bigint; second_no bigint;
BEGIN
  IF (SELECT count(*) FROM public.bookings WHERE booking_no BETWEEN 1 AND 16) <> 16 THEN
    RAISE EXCEPTION 'Expected the 16 retained appointments numbered 1 through 16';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bookings WHERE reference = 'BK-QMK34Y' AND meta->>'status' = 'completed') THEN
    RAISE EXCEPTION 'Hemanth must be completed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bookings WHERE reference = 'BK-JAJ4T2' AND status = 'cancelled' AND booking_no IS NULL) THEN
    RAISE EXCEPTION 'Meera cancellation must release its number';
  END IF;
  INSERT INTO public.bookings(reference, audience, date, time, customer, meta, archived_at)
  VALUES ('QA-NUMBER-A', 'men', '2000-01-01', 540, '{}'::jsonb, '{"status":"completed"}'::jsonb, now())
  RETURNING booking_no INTO first_no;
  IF first_no <> 17 THEN RAISE EXCEPTION 'Next appointment must receive number 17'; END IF;
  UPDATE public.bookings SET status = 'cancelled' WHERE reference = 'QA-NUMBER-A';
  IF EXISTS (SELECT 1 FROM public.bookings WHERE reference = 'QA-NUMBER-A' AND booking_no IS NOT NULL) THEN
    RAISE EXCEPTION 'Cancellation must release number 17';
  END IF;
  INSERT INTO public.bookings(reference, audience, date, time, customer, meta, archived_at)
  VALUES ('QA-NUMBER-B', 'men', '2000-01-01', 540, '{}'::jsonb, '{"status":"completed"}'::jsonb, now())
  RETURNING booking_no INTO second_no;
  IF second_no <> 17 THEN RAISE EXCEPTION 'Released number 17 must be reused'; END IF;
  UPDATE public.bookings SET meta = '{"status":"completed"}'::jsonb WHERE reference = 'QA-NUMBER-B';
  IF NOT EXISTS (SELECT 1 FROM public.bookings WHERE reference = 'QA-NUMBER-B' AND booking_no = 17) THEN
    RAISE EXCEPTION 'Completed visit must retain number 17';
  END IF;
  INSERT INTO public.bookings(reference, audience, date, time, customer, meta, archived_at)
  VALUES ('QA-NUMBER-C', 'men', '2000-01-01', 540, '{}'::jsonb, '{"status":"completed"}'::jsonb, now())
  RETURNING booking_no INTO second_no;
  IF second_no <> 18 THEN RAISE EXCEPTION 'Numbers must continue upwards after retained visits'; END IF;
  BEGIN
    UPDATE public.bookings SET booking_no = 17 WHERE reference = 'QA-NUMBER-C';
    RAISE EXCEPTION 'Duplicate reusable booking numbers must be rejected';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
  IF NOT EXISTS (SELECT 1 FROM public.bookings WHERE reference = 'QA-NUMBER-C' AND booking_no = 18) THEN
    RAISE EXCEPTION 'Rejected duplicate must preserve the appointment number and reference';
  END IF;
END $$;
ROLLBACK;