-- ============================================================
-- rls.sql - Customer QR Tracker - Row Level Security
-- ============================================================
-- Da applicare DOPO sql/schema.sql nello SQL Editor di Supabase.
-- Vedi sql/README.md per la procedura completa di setup.
--
-- Idempotente: helper e trigger functions sono CREATE OR REPLACE,
-- trigger e policy sono DROP IF EXISTS prima del CREATE.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Helper functions
-- ------------------------------------------------------------
-- current_user_role() bypassa RLS su profiles tramite SECURITY
-- DEFINER (altrimenti loop). Le altre helper sono wrapper
-- booleani sql STABLE.
-- ------------------------------------------------------------

create or replace function public.current_user_role()
returns public.user_role
language sql stable security definer
set search_path = public
as $$
  select role from public.profiles
   where id = auth.uid()
     and deleted_at is null
$$;

create or replace function public.is_operator()
returns boolean language sql stable
set search_path = public
as $$ select public.current_user_role() = 'operator' $$;

create or replace function public.is_admin()
returns boolean language sql stable
set search_path = public
as $$ select public.current_user_role() = 'admin' $$;

create or replace function public.is_super_admin()
returns boolean language sql stable
set search_path = public
as $$ select public.current_user_role() = 'super_admin' $$;

create or replace function public.is_admin_or_above()
returns boolean language sql stable
set search_path = public
as $$ select public.current_user_role() in ('admin', 'super_admin') $$;

create or replace function public.is_operator_or_above()
returns boolean language sql stable
set search_path = public
as $$ select public.current_user_role() is not null $$;

-- ------------------------------------------------------------
-- 2. Trigger functions
-- ------------------------------------------------------------

-- profiles: protegge id e created_at; auto-popola
-- last_modified_at. last_modified_by_id viene preservato se gia'
-- valorizzato dal chiamante (es. una Edge Function che agisce
-- per conto di un altro utente), altrimenti settato a auth.uid().
create or replace function public.profiles_protect_immutable()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  if new.id         is distinct from old.id         then raise exception 'profiles.id is immutable';         end if;
  if new.created_at is distinct from old.created_at then raise exception 'profiles.created_at is immutable'; end if;

  new.last_modified_by_id := coalesce(new.last_modified_by_id, auth.uid());
  new.last_modified_at    := now();
  return new;
end $$;

-- customers: protegge id, qr_token, created_by_id, created_at;
-- auto-popola last_modified_*.
create or replace function public.customers_protect_immutable()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  if new.id            is distinct from old.id            then raise exception 'customers.id is immutable';            end if;
  if new.qr_token      is distinct from old.qr_token      then raise exception 'customers.qr_token is immutable';      end if;
  if new.created_by_id is distinct from old.created_by_id then raise exception 'customers.created_by_id is immutable'; end if;
  if new.created_at    is distinct from old.created_at    then raise exception 'customers.created_at is immutable';    end if;

  new.last_modified_by_id := auth.uid();
  new.last_modified_at    := now();
  return new;
end $$;

-- transactions: tutti i campi sono immutabili tranne i 4 di
-- pagamento (paid, paid_at, payment_method, paid_by_id).
-- deleted_at non e' modificabile via UPDATE: se serve cancellare
-- una transazione (caso eccezionale), va fatto via Edge Function
-- che bypassa RLS e i trigger.
create or replace function public.transactions_protect_immutable()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  if new.id              is distinct from old.id              then raise exception 'transactions.id is immutable';              end if;
  if new.customer_id     is distinct from old.customer_id     then raise exception 'transactions.customer_id is immutable';     end if;
  if new.user_id         is distinct from old.user_id         then raise exception 'transactions.user_id is immutable';         end if;
  if new.type            is distinct from old.type            then raise exception 'transactions.type is immutable';            end if;
  if new.amount          is distinct from old.amount          then raise exception 'transactions.amount is immutable';          end if;
  if new.reversal_of_id  is distinct from old.reversal_of_id  then raise exception 'transactions.reversal_of_id is immutable';  end if;
  if new.notes           is distinct from old.notes           then raise exception 'transactions.notes is immutable';           end if;
  if new.created_at      is distinct from old.created_at      then raise exception 'transactions.created_at is immutable';      end if;
  if new.deleted_at      is distinct from old.deleted_at      then raise exception 'transactions.deleted_at is not modifiable via UPDATE';  end if;
  return new;
end $$;

-- transactions: validazione reversal cross-row.
-- Lo storno e' SEMPRE TOTALE: amount del reversal = amount della
-- charge originale. La unicita' di reversal_of_id (vincolo UNIQUE
-- sulla colonna) garantisce che una charge possa essere stornata
-- al massimo UNA VOLTA.
-- Verifiche fatte qui:
-- 1. La charge referenziata esiste, e' dello stesso customer,
--    type='charge', non pagata, non cancellata.
-- 2. amount del reversal == amount della charge.
create or replace function public.transactions_validate_reversal()
returns trigger language plpgsql security definer
set search_path = public
as $$
declare
  v_charge_amount numeric;
begin
  if new.type = 'reversal' then
    select amount into v_charge_amount
      from public.transactions
     where id = new.reversal_of_id
       and customer_id = new.customer_id
       and type = 'charge'
       and paid = false
       and deleted_at is null;
    if v_charge_amount is null then
      raise exception 'reversal_of_id deve riferirsi a una charge non pagata dello stesso customer';
    end if;

    if new.amount <> v_charge_amount then
      raise exception 'reversal amount must equal charge amount: charge=%, reversal=%',
        v_charge_amount, new.amount;
    end if;
  end if;
  return new;
end $$;

-- ------------------------------------------------------------
-- 3. Trigger CREATE
-- ------------------------------------------------------------

drop trigger if exists profiles_before_update on public.profiles;
create trigger profiles_before_update
  before update on public.profiles
  for each row execute function public.profiles_protect_immutable();

drop trigger if exists customers_before_update on public.customers;
create trigger customers_before_update
  before update on public.customers
  for each row execute function public.customers_protect_immutable();

drop trigger if exists transactions_before_update on public.transactions;
create trigger transactions_before_update
  before update on public.transactions
  for each row execute function public.transactions_protect_immutable();

drop trigger if exists transactions_before_insert on public.transactions;
create trigger transactions_before_insert
  before insert on public.transactions
  for each row execute function public.transactions_validate_reversal();

-- ------------------------------------------------------------
-- 4. Abilitazione RLS
-- ------------------------------------------------------------
-- FORCE significa che anche il proprietario della tabella
-- (postgres user che esegue le migration) e' soggetto alle
-- policy. Le Edge Functions con service_role mantengono il
-- bypass via supabase_admin.
-- ------------------------------------------------------------

alter table public.profiles     enable row level security;
alter table public.profiles     force  row level security;

alter table public.customers    enable row level security;
alter table public.customers    force  row level security;

alter table public.transactions enable row level security;
alter table public.transactions force  row level security;

-- ------------------------------------------------------------
-- 5. Policy: profiles
-- ------------------------------------------------------------
-- INSERT/UPDATE/DELETE non hanno policy: tutto via Edge
-- Functions con service_role.
-- ------------------------------------------------------------

drop policy if exists profiles_select_self         on public.profiles;
drop policy if exists profiles_select_admin_active on public.profiles;
drop policy if exists profiles_select_super_admin  on public.profiles;

-- ognuno legge sempre il proprio profilo
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = auth.uid());

-- admin vede tutti i profili attivi
create policy profiles_select_admin_active on public.profiles
  for select to authenticated
  using (deleted_at is null and public.is_admin());

-- super_admin vede tutti i profili, inclusi cancellati
create policy profiles_select_super_admin on public.profiles
  for select to authenticated
  using (public.is_super_admin());

-- ------------------------------------------------------------
-- 6. Policy: customers
-- ------------------------------------------------------------

drop policy if exists customers_select_active      on public.customers;
drop policy if exists customers_select_super_admin on public.customers;
drop policy if exists customers_insert             on public.customers;
drop policy if exists customers_update_attributes  on public.customers;
drop policy if exists customers_update_soft_delete on public.customers;

-- operator+ legge clienti attivi
create policy customers_select_active on public.customers
  for select to authenticated
  using (deleted_at is null and public.is_operator_or_above());

-- super_admin vede anche cancellati
create policy customers_select_super_admin on public.customers
  for select to authenticated
  using (public.is_super_admin());

-- operator+ crea cliente; created_by_id obbligato a auth.uid()
create policy customers_insert on public.customers
  for insert to authenticated
  with check (
    public.is_operator_or_above()
    and created_by_id = auth.uid()
    and deleted_at is null
    and last_modified_by_id is null
    and last_modified_at is null
  );

-- operator+ aggiorna anagrafica (deleted_at deve restare NULL)
create policy customers_update_attributes on public.customers
  for update to authenticated
  using (deleted_at is null and public.is_operator_or_above())
  with check (deleted_at is null);

-- admin+ puo' fare soft-delete (settare deleted_at)
create policy customers_update_soft_delete on public.customers
  for update to authenticated
  using (deleted_at is null and public.is_admin_or_above())
  with check (public.is_admin_or_above());

-- ------------------------------------------------------------
-- 7. Policy: transactions
-- ------------------------------------------------------------

drop policy if exists transactions_select_active      on public.transactions;
drop policy if exists transactions_select_super_admin on public.transactions;
drop policy if exists transactions_insert             on public.transactions;
drop policy if exists transactions_update_close       on public.transactions;

-- operator+ legge transazioni attive
create policy transactions_select_active on public.transactions
  for select to authenticated
  using (deleted_at is null and public.is_operator_or_above());

-- super_admin vede tutte (anche cancellate)
create policy transactions_select_super_admin on public.transactions
  for select to authenticated
  using (public.is_super_admin());

-- operator+ inserisce charge o reversal, sempre paid=false
create policy transactions_insert on public.transactions
  for insert to authenticated
  with check (
    public.is_operator_or_above()
    and user_id = auth.uid()
    and paid = false
    and paid_at is null
    and payment_method is null
    and paid_by_id is null
    and deleted_at is null
  );

-- admin+ chiude conto: paid=false -> paid=true, paid_by_id=auth.uid()
create policy transactions_update_close on public.transactions
  for update to authenticated
  using (
    deleted_at is null
    and paid = false
    and public.is_admin_or_above()
  )
  with check (
    paid = true
    and paid_by_id = auth.uid()
    and paid_at is not null
    and payment_method is not null
  );

-- ------------------------------------------------------------
-- 8. Privilegi sulle helper / trigger functions
-- ------------------------------------------------------------
-- Default Postgres: ogni funzione e' GRANT EXECUTE TO PUBLIC.
-- Lo lasciamo solo dove serve. Riduzione superficie d'attacco
-- segnalata dagli advisor Supabase (search_path mutable e
-- SECURITY DEFINER esposte via /rest/v1/rpc).
-- ------------------------------------------------------------

-- current_user_role e' helper interno. Le policy authenticated la
-- chiamano via is_admin/is_operator/... e quindi authenticated
-- DEVE mantenere EXECUTE. anon e' anonimo: chiamarla via REST
-- ritornerebbe NULL, ma non c'e' motivo di esporla.
revoke execute on function public.current_user_role() from public, anon;

-- Trigger functions: NON sono pensate per essere chiamate via
-- REST. Le trigger continuano a funzionare perche' le invoca il
-- sistema (BEFORE INSERT/UPDATE), non i client.
revoke execute on function public.customers_protect_immutable()    from public, anon, authenticated;
revoke execute on function public.profiles_protect_immutable()     from public, anon, authenticated;
revoke execute on function public.transactions_protect_immutable() from public, anon, authenticated;
revoke execute on function public.transactions_validate_reversal() from public, anon, authenticated;

-- ------------------------------------------------------------
-- 9. Verifiche post-applicazione (opzionali, da eseguire a mano)
-- ------------------------------------------------------------
-- -- policy attive per tabella (cast il literal a regclass: il
-- -- ::regclass::text varia in base al search_path):
-- select polrelid::regclass as tabella, polname, polcmd
--   from pg_policy
--  where polrelid in (
--        'public.profiles'::regclass,
--        'public.customers'::regclass,
--        'public.transactions'::regclass
--        )
--  order by polrelid::regclass::text, polname;
--
-- -- RLS abilitato + force (forcerowsecurity vive in pg_class, non in pg_tables):
-- select c.relname             as tablename,
--        c.relrowsecurity      as rowsecurity,
--        c.relforcerowsecurity as forcerowsecurity
--   from pg_class c
--   join pg_namespace n on n.oid = c.relnamespace
--  where n.nspname = 'public'
--    and c.relname in ('profiles','customers','transactions');
--
-- -- trigger attivi (escluso quelli interni):
-- select tgname, tgrelid::regclass
--   from pg_trigger
--  where tgrelid in (
--        'public.profiles'::regclass,
--        'public.customers'::regclass,
--        'public.transactions'::regclass
--        )
--    and not tgisinternal;
