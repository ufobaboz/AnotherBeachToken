-- Schema idempotente. Applicare prima di rls.sql.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('operator', 'admin', 'super_admin');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'transaction_type') then
    create type public.transaction_type as enum ('charge', 'reversal');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'payment_method') then
    create type public.payment_method as enum ('cash', 'card', 'transfer', 'other');
  end if;
end $$;

create table if not exists public.profiles (
  id                    uuid primary key references auth.users(id) on delete cascade,
  first_name            text        not null,
  last_name             text        not null,
  role                  public.user_role not null default 'operator',
  last_login_at         timestamptz,
  notes                 text,
  created_at            timestamptz not null default now(),
  last_modified_by_id   uuid        references public.profiles(id) on delete set null,
  last_modified_at      timestamptz,
  deleted_at            timestamptz
);

-- qr_token: bearer secret mostrato come QR sulla pagina pubblica /qr/<token>.
create table if not exists public.customers (
  id                    uuid primary key default gen_random_uuid(),
  qr_token              text        not null unique,
  first_name            text        not null,
  last_name             text        not null,
  email                 text,
  phone                 text        not null,
  notes                 text,
  created_by_id         uuid        not null references public.profiles(id) on delete restrict,
  last_modified_by_id   uuid        references public.profiles(id) on delete set null,
  last_modified_at      timestamptz,
  created_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  constraint customers_qr_token_format check (qr_token ~ '^[A-Z2-7]{32}$')
);

-- Concettualmente immutabili, mutano solo per la chiusura conto.
create table if not exists public.transactions (
  id                    uuid primary key default gen_random_uuid(),
  customer_id           uuid        not null references public.customers(id) on delete restrict,
  user_id               uuid        not null references public.profiles(id)  on delete restrict,
  type                  public.transaction_type not null,
  amount                numeric(10,2) not null,
  reversal_of_id        uuid        unique references public.transactions(id) on delete restrict,
  paid                  boolean     not null default false,
  paid_at               timestamptz,
  payment_method        public.payment_method,
  paid_by_id            uuid        references public.profiles(id) on delete restrict,
  notes                 text,
  created_at            timestamptz not null default now(),
  deleted_at            timestamptz,

  constraint transactions_amount_positive
    check (amount > 0),

  constraint transactions_paid_coherence
    check (
      (paid = false
        and paid_at is null
        and payment_method is null
        and paid_by_id is null)
      or
      (paid = true
        and paid_at is not null
        and payment_method is not null
        and paid_by_id is not null)
    ),

  constraint transactions_reversal_coherence
    check (
      (type = 'charge'   and reversal_of_id is null)
      or
      (type = 'reversal' and reversal_of_id is not null)
    )
);

grant select, insert, update, delete on public.profiles     to authenticated, service_role;
grant select, insert, update, delete on public.customers    to authenticated, service_role;
grant select, insert, update, delete on public.transactions to authenticated, service_role;

-- Indici on-demand: PK/UNIQUE creano i propri impliciti, qui solo la FK
-- transactions(customer_id) per join hot path.
create index if not exists transactions_customer_idx
  on public.transactions (customer_id);

-- SECURITY DEFINER: bypassa RLS, espone solo first_name + open_balance
-- al portatore del token (gia' bearer del QR).

-- DROP IF EXISTS prima del CREATE OR REPLACE: cambiare il return type su
-- una function esistente da "ERROR: 42P13 cannot change return type".
drop function if exists public.get_customer_qr_info(text);

create or replace function public.get_customer_qr_info(p_token text)
returns table(first_name text, open_balance numeric)
language sql
security definer
stable
set search_path = public
as $$
  -- coalesce interno su entrambi gli addendi: sum FILTER torna NULL se
  -- nessuna riga matcha; senza, charges - NULL = NULL e il coalesce esterno
  -- mascherebbe il bug a 0 invece del saldo reale.
  select c.first_name,
         coalesce(
           (select coalesce(sum(t.amount) filter (where t.type = 'charge'), 0)
                 - coalesce(sum(t.amount) filter (where t.type = 'reversal'), 0)
              from public.transactions t
             where t.customer_id = c.id
               and t.paid = false
               and t.deleted_at is null),
           0
         )::numeric(10,2) as open_balance
    from public.customers c
   where c.qr_token = p_token
     and c.deleted_at is null;
$$;

revoke all on function public.get_customer_qr_info(text) from public;
grant execute on function public.get_customer_qr_info(text) to anon, authenticated;

-- TRUNCATE multi-tabella ignora la FK ON DELETE RESTRICT perche' svuota
-- entrambe nello stesso comando. profiles NON tocco: gli operator restano
-- fra una stagione e l'altra. SECURITY DEFINER perche' TRUNCATE richiede
-- ownership; mai esposto a anon/authenticated.

drop function if exists public.reset_season();

create or replace function public.reset_season()
returns void
language sql
security definer
set search_path = public
as $$
  truncate table public.transactions, public.customers;
$$;

-- Postgres concede EXECUTE a PUBLIC su ogni nuova function. Revoke + grant
-- esplicito a service_role: anon/authenticated ereditano da PUBLIC -> no EXECUTE.
revoke execute on function public.reset_season() from public;
grant  execute on function public.reset_season() to service_role;

-- Header in italiano: deroga consapevole alle convenzioni di SPEC sez 3.
-- Il report e' per contabile/audit, non re-import tecnico. Soft-deleted
-- inclusi (sia customers che transactions) per coerenza col flusso utente.

drop function if exists public.get_archive_aggregates();

create or replace function public.get_archive_aggregates()
returns table(
  cliente                     text,
  email                       text,
  telefono                    text,
  note_cliente                text,
  data_registrazione          timestamptz,
  data_cancellazione_cliente  timestamptz,
  numero_transazioni          bigint,
  numero_addebiti             bigint,
  numero_storni               bigint,
  totale_addebiti_eur         numeric,
  totale_storni_eur           numeric,
  saldo_aperto_eur            numeric,
  totale_pagato_eur           numeric,
  ultima_transazione          timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_admin_or_above() then
    raise exception 'forbidden: only admin or super_admin can run get_archive_aggregates'
      using errcode = '42501';
  end if;

  return query
  select
    c.first_name || ' ' || c.last_name,
    c.email,
    c.phone,
    c.notes,
    c.created_at,
    c.deleted_at,
    coalesce(agg.numero_transazioni, 0)::bigint,
    coalesce(agg.numero_addebiti,    0)::bigint,
    coalesce(agg.numero_storni,      0)::bigint,
    coalesce(agg.totale_addebiti,    0)::numeric(10,2),
    coalesce(agg.totale_storni,      0)::numeric(10,2),
    coalesce(agg.saldo_aperto,       0)::numeric(10,2),
    coalesce(agg.totale_pagato,      0)::numeric(10,2),
    agg.ultima_transazione
  from public.customers c
  left join (
    select
      customer_id,
      count(*)                                                  as numero_transazioni,
      count(*) filter (where type = 'charge')                   as numero_addebiti,
      count(*) filter (where type = 'reversal')                 as numero_storni,
      coalesce(sum(amount) filter (where type = 'charge'),   0) as totale_addebiti,
      coalesce(sum(amount) filter (where type = 'reversal'), 0) as totale_storni,
      coalesce(sum(amount) filter (where type = 'charge'   and paid = false), 0)
        - coalesce(sum(amount) filter (where type = 'reversal' and paid = false), 0)
                                                                as saldo_aperto,
      coalesce(sum(amount) filter (where type = 'charge'   and paid = true), 0)
        - coalesce(sum(amount) filter (where type = 'reversal' and paid = true), 0)
                                                                as totale_pagato,
      max(created_at)                                           as ultima_transazione
    from public.transactions
    group by customer_id
  ) agg on agg.customer_id = c.id
  order by c.last_name, c.first_name, c.created_at;
end;
$$;

-- Supabase concede EXECUTE a anon via default privileges su ogni nuova
-- function: revoke from public NON lo copre, serve revoke esplicito.
revoke execute on function public.get_archive_aggregates() from public, anon;
grant  execute on function public.get_archive_aggregates() to authenticated;

-- Enum tradotti via CASE SQL per evitare lookup client-side.
drop function if exists public.get_archive_details();

create or replace function public.get_archive_details()
returns table(
  tipo                text,
  importo_eur         numeric,
  note                text,
  data_registrazione  timestamptz,
  data_cancellazione  timestamptz,
  operatore           text,
  pagato              text,
  data_pagamento      timestamptz,
  metodo_pagamento    text,
  incassato_da        text,
  cliente             text,
  telefono_cliente    text
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_admin_or_above() then
    raise exception 'forbidden: only admin or super_admin can run get_archive_details'
      using errcode = '42501';
  end if;

  return query
  select
    case t.type
      when 'charge'   then 'Addebito'
      when 'reversal' then 'Storno'
    end,
    t.amount,
    t.notes,
    t.created_at,
    t.deleted_at,
    op.first_name || ' ' || op.last_name,
    case when t.paid then 'Si' else 'No' end,
    t.paid_at,
    case t.payment_method
      when 'cash'     then 'Contanti'
      when 'card'     then 'Carta'
      when 'transfer' then 'Bonifico'
      when 'other'    then 'Altro'
    end,
    case when pay.id is null then null
         else pay.first_name || ' ' || pay.last_name end,
    c.first_name || ' ' || c.last_name,
    c.phone
  from public.transactions t
  join public.customers c on c.id = t.customer_id
  join public.profiles  op on op.id = t.user_id
  left join public.profiles pay on pay.id = t.paid_by_id
  order by t.created_at desc;
end;
$$;

revoke execute on function public.get_archive_details() from public, anon;
grant  execute on function public.get_archive_details() to authenticated;
