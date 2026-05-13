-- DEV ONLY. Non applicare su PRD.
-- Hard delete idempotente dei dati generati dalla Playwright suite.
-- Pattern: profiles.last_name LIKE 'ZZ-E2E%', customers.last_name LIKE 'ZZ-E2E%',
--          auth.users.email LIKE 'e2e-op-%' OR 'e2e-adm-%'.
-- Chiamata dall'edge function e2e-cleanup (super_admin only, guard IS_DEV_ENV).
-- SECURITY DEFINER owned by postgres: serve per cancellare da auth.users.

drop function if exists public._e2e_bulk_cleanup();

create or replace function public._e2e_bulk_cleanup()
returns table(
  tx_deleted        bigint,
  customers_deleted bigint,
  users_deleted     bigint
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_tx_rev   bigint := 0;
  v_tx_rest  bigint := 0;
  v_cust     bigint := 0;
  v_users    bigint := 0;
begin
  -- reversal_of_id ON DELETE RESTRICT: prima le reversal, poi le charge.
  delete from public.transactions
  where type = 'reversal'
    and (customer_id in (select id from public.customers where last_name like 'ZZ-E2E%')
      or user_id     in (select id from public.profiles  where last_name like 'ZZ-E2E%')
      or paid_by_id  in (select id from public.profiles  where last_name like 'ZZ-E2E%'));
  get diagnostics v_tx_rev = row_count;

  delete from public.transactions
  where customer_id in (select id from public.customers where last_name like 'ZZ-E2E%')
     or user_id     in (select id from public.profiles  where last_name like 'ZZ-E2E%')
     or paid_by_id  in (select id from public.profiles  where last_name like 'ZZ-E2E%');
  get diagnostics v_tx_rest = row_count;

  delete from public.customers where last_name like 'ZZ-E2E%';
  get diagnostics v_cust = row_count;

  -- auth.users -> CASCADE su public.profiles (FK profiles.id ON DELETE CASCADE).
  delete from auth.users
  where email like 'e2e-op-%' or email like 'e2e-adm-%';
  get diagnostics v_users = row_count;

  return query select v_tx_rev + v_tx_rest, v_cust, v_users;
end;
$fn$;

revoke execute on function public._e2e_bulk_cleanup() from public, anon, authenticated;
grant  execute on function public._e2e_bulk_cleanup() to service_role;
