CREATE OR REPLACE FUNCTION public.complete_elapsed_confirmed_visits(p_now timestamptz DEFAULT now())
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE affected integer;
BEGIN
  UPDATE public.bookings b
  SET meta = COALESCE(b.meta, '{}'::jsonb) || jsonb_build_object('status', 'completed', 'auto_completed_at', p_now),
      history = COALESCE(b.history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', p_now, 'by', 'system', 'action', 'status:completed', 'reason', 'Automatically completed two hours after the booked service end'))
  WHERE b.status = 'confirmed' AND b.archived_at IS NULL
    AND COALESCE(b.meta->>'status', '') IN ('', 'upcoming')
    AND ((b.date::timestamp + make_interval(mins => b.time + COALESCE(b.duration_minutes, b.slots * 30))) AT TIME ZONE 'Asia/Kolkata') + interval '2 hours' <= p_now;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_elapsed_confirmed_visits(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_elapsed_confirmed_visits(timestamptz) TO service_role;