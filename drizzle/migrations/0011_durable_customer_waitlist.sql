CREATE TABLE public.customer_waitlist (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 date text NOT NULL,
 criteria_key text NOT NULL,
 entry jsonb NOT NULL,
 claimed_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(date, criteria_key)
);
GRANT ALL ON public.customer_waitlist TO service_role;
REVOKE ALL ON public.customer_waitlist FROM anon, authenticated;
ALTER TABLE public.customer_waitlist ENABLE ROW LEVEL SECURITY;
CREATE INDEX customer_waitlist_date_idx ON public.customer_waitlist(date);
INSERT INTO public.customer_waitlist(date, criteria_key, entry)
SELECT substring(s.key from 10), md5(e.value->>'endpoint' || '|' || (e.value->'serviceIds')::text || '|' || coalesce(e.value->>'staffId', 'any') || '|' || coalesce(e.value->>'audience', '')), e.value
FROM public.site_settings s CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.value) = 'array' THEN s.value ELSE '[]'::jsonb END) e
WHERE s.key LIKE 'waitlist:%'
ON CONFLICT DO NOTHING;
CREATE FUNCTION public.join_customer_waitlist(p_date text, p_entry jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('customer_waitlist:' || p_date));
 k := md5(p_entry->>'endpoint' || '|' || (p_entry->'serviceIds')::text || '|' || coalesce(p_entry->>'staffId', 'any') || '|' || coalesce(p_entry->>'audience', ''));
 IF (SELECT count(*) FROM public.customer_waitlist WHERE date = p_date) >= 100 AND NOT EXISTS(SELECT 1 FROM public.customer_waitlist WHERE date = p_date AND criteria_key = k) THEN RETURN false; END IF;
 INSERT INTO public.customer_waitlist(date, criteria_key, entry) VALUES(p_date,k,p_entry)
 ON CONFLICT(date,criteria_key) DO UPDATE SET entry=EXCLUDED.entry;
 RETURN true;
END $$;
CREATE FUNCTION public.claim_customer_waitlist(p_date text) RETURNS SETOF public.customer_waitlist
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
 UPDATE public.customer_waitlist SET claimed_until = now() + interval '2 minutes'
 WHERE id IN (SELECT id FROM public.customer_waitlist WHERE date = p_date AND (claimed_until IS NULL OR claimed_until < now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 20)
 RETURNING *;
$$;
REVOKE ALL ON FUNCTION public.join_customer_waitlist(text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_customer_waitlist(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_customer_waitlist(text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_customer_waitlist(text) TO service_role;