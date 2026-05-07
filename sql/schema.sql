-- ============================================================
-- schema.sql - Customer QR Tracker
-- ============================================================
-- Schema idempotente per Supabase (PostgreSQL 17.x).
-- Da applicare per primo, prima di rls.sql. Vedi sql/README.md
-- per la procedura completa di setup del database.
-- ============================================================

-- ------------------------------------------------------------
-- Estensioni
-- ------------------------------------------------------------

create extension if not exists pgcrypto;
-- pgcrypto fornisce gen_random_uuid() per i default delle PK.

-- ------------------------------------------------------------
-- Enum
-- ------------------------------------------------------------

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

-- ------------------------------------------------------------
-- profiles
-- ------------------------------------------------------------
-- Operatori dell'app. Relazione 1:1 con auth.users di Supabase.
-- L'auto-FK su last_modified_by_id e' gestita lato applicativo.
-- ------------------------------------------------------------

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

-- ------------------------------------------------------------
-- customers
-- ------------------------------------------------------------
-- Anagrafica dei clienti del villaggio. qr_token e' il segreto
-- mostrato come QR e via pagina pubblica. Format obbligatorio:
-- 32 caratteri base32 (A-Z, 2-7).
-- ------------------------------------------------------------

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

-- ------------------------------------------------------------
-- transactions
-- ------------------------------------------------------------
-- Addebiti e storni di un cliente. Concettualmente immutabili,
-- mutano solo per la chiusura conto (paid, paid_at,
-- payment_method, paid_by_id). reversal_of_id collega lo storno
-- alla charge che corregge.
-- ------------------------------------------------------------

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

-- ------------------------------------------------------------
-- Indici
-- ------------------------------------------------------------
-- Set minimale: un solo indice esplicito sulla FK piu' usata.
-- PK e UNIQUE creano gia' i propri indici impliciti.
-- Altri indici saranno aggiunti on-demand sulla base di query
-- lente osservate in produzione (pg_stat_statements).
-- ------------------------------------------------------------

create index if not exists transactions_customer_idx
  on public.transactions (customer_id);

-- ------------------------------------------------------------
-- RPC: get_customer_qr_info
-- ------------------------------------------------------------
-- Usata dalla pagina pubblica /qr/<token> per personalizzare il
-- saluto e mostrare il saldo aperto. SECURITY DEFINER: bypassa
-- RLS, ma espone solo first_name + open_balance. Il token funge
-- da bearer: chi lo conosce ha gia' accesso al QR. Nessun
-- leakage extra (no cognome/telefono/email/storico).
-- open_balance segue la formula di SPEC sez 4 (charge non pagate
-- meno reversal non pagati, escluso soft-deleted), arrotondato
-- a numeric(10,2). Per un cliente senza alcuna transactions:
-- open_balance = 0 (coalesce esplicito).
-- ------------------------------------------------------------

-- DROP esplicito prima del CREATE OR REPLACE: cambiare il
-- return type di una funzione esistente non e' supportato da
-- "create or replace function". Senza DROP, riapplicare lo
-- script su un DB con una versione precedente della RPC fallisce
-- con "ERROR: 42P13 cannot change return type". DROP IF EXISTS
-- mantiene l'idempotenza per nuove installazioni.
drop function if exists public.get_customer_qr_info(text);

create or replace function public.get_customer_qr_info(p_token text)
returns table(first_name text, open_balance numeric)
language sql
security definer
stable
set search_path = public
as $$
  select c.first_name,
         coalesce(
           (select sum(t.amount) filter (where t.type = 'charge')
                 - sum(t.amount) filter (where t.type = 'reversal')
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

-- ------------------------------------------------------------
-- Verifiche post-applicazione (opzionali, da eseguire a mano)
-- ------------------------------------------------------------
-- select typname from pg_type where typname in ('user_role','transaction_type','payment_method');
-- select tablename from pg_tables where schemaname='public' and tablename in ('profiles','customers','transactions');
-- select indexname from pg_indexes where schemaname='public' and tablename='transactions';
-- select * from public.get_customer_qr_info('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
-- atteso: 0 righe (token inesistente). Su un cliente reale:
-- 1 riga (first_name, open_balance). open_balance=0 se nessuna transaction.
