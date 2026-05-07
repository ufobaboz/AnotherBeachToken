-- ============================================================
-- 00_hello.sql -- Smoke test RPC per Supabase
-- ============================================================
-- Crea una funzione che il ruolo anon puo' chiamare per
-- verificare che la connessione frontend -> Supabase funzioni
-- end-to-end. Da eseguire UNA volta nello SQL Editor di Supabase.
-- ============================================================

create or replace function public.hello_world()
returns table(message text, server_time timestamptz, db_version text)
language sql
stable
as $$
  select
    'Hello from Supabase'::text       as message,
    now()                              as server_time,
    current_setting('server_version')  as db_version;
$$;

revoke all on function public.hello_world() from public;
grant execute on function public.hello_world() to anon, authenticated;

-- Verifica:
select * from public.hello_world();
