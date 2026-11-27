-- Visitors never read or write tables directly: every page goes through the
-- server, which uses the service role. Row-level security (on for every table,
-- with no public policies) already blocks reads and writes, but the public
-- roles still held table privileges such as TRUNCATE, which RLS does not cover.
-- Remove them so the database refuses public access at both layers.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t.tablename);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t.tablename);
  END LOOP;
END $$;
