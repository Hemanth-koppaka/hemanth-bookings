CREATE TABLE public.admin_assistant_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_hash text NOT NULL,
 conversation_id uuid NOT NULL,
 action text NOT NULL,
 arguments jsonb NOT NULL,
 summary text NOT NULL,
 before_state jsonb,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','executing','succeeded','failed','cancelled','unknown')),
 result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
 finished_at timestamptz
);
GRANT ALL ON public.admin_assistant_operations TO service_role;
REVOKE ALL ON public.admin_assistant_operations FROM anon, authenticated;
ALTER TABLE public.admin_assistant_operations ENABLE ROW LEVEL SECURITY;
CREATE INDEX admin_assistant_operations_owner ON public.admin_assistant_operations(owner_hash, conversation_id, created_at DESC);
CREATE UNIQUE INDEX admin_assistant_one_pending ON public.admin_assistant_operations(owner_hash, conversation_id) WHERE status = 'pending';
COMMENT ON TABLE public.admin_assistant_operations IS 'Private admin assistant exact-argument proposals and one-time execution outcomes; access requires server-validated admin sessions.';