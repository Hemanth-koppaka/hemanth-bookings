CREATE OR REPLACE FUNCTION public.refresh_booking_service_prices(p_snapshot jsonb, p_service_ids text[])
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(item || CASE WHEN s.id IS NOT NULL THEN jsonb_build_object('price', s.price) ELSE '{}'::jsonb END ORDER BY ord), '[]'::jsonb)
  FROM jsonb_array_elements(CASE WHEN jsonb_array_length(COALESCE(p_snapshot, '[]'::jsonb)) > 0 THEN p_snapshot ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'price', s.price, 'minutes', s.duration_minutes) ORDER BY ids.ord) FROM unnest(p_service_ids) WITH ORDINALITY ids(id, ord) JOIN public.services s ON s.id = ids.id), '[]'::jsonb) END) WITH ORDINALITY x(item, ord)
  LEFT JOIN public.services s ON s.id = COALESCE(item->>'id', p_service_ids[ord::int]);
$$;
REVOKE ALL ON FUNCTION public.refresh_booking_service_prices(jsonb, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_booking_service_prices(jsonb, text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.sync_unfinished_booking_price()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IN ('cancelled', 'completed', 'no-show') OR COALESCE(NEW.meta->>'status', '') IN ('cancelled', 'completed', 'no-show') OR NEW.archived_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  -- A completed record's historical amount stays fixed, even if it is later restored.
  IF TG_OP = 'UPDATE' AND (OLD.status = 'completed' OR COALESCE(OLD.meta->>'status', '') = 'completed') THEN
    RETURN NEW;
  END IF;
  NEW.services_snapshot := public.refresh_booking_service_prices(NEW.services_snapshot, NEW.service_ids);
  SELECT COALESCE(sum((item->>'price')::integer), 0) INTO NEW.price_total FROM jsonb_array_elements(NEW.services_snapshot) item;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_unfinished_booking_price() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_unfinished_booking_price() TO service_role;
CREATE TRIGGER bookings_current_price BEFORE INSERT OR UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.sync_unfinished_booking_price();

CREATE OR REPLACE FUNCTION public.propagate_service_price_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.bookings SET services_snapshot = services_snapshot
  WHERE NEW.id = ANY(service_ids)
    AND status NOT IN ('cancelled', 'completed', 'no-show')
    AND COALESCE(meta->>'status', '') NOT IN ('cancelled', 'completed', 'no-show')
    AND archived_at IS NULL;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.propagate_service_price_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.propagate_service_price_change() TO service_role;
CREATE TRIGGER services_update_booking_prices AFTER UPDATE OF price ON public.services FOR EACH ROW WHEN (OLD.price IS DISTINCT FROM NEW.price) EXECUTE FUNCTION public.propagate_service_price_change();