-- RLS idempotente. Applicare DOPO sql/schema.sql.

-- current_user_role(): SECURITY DEFINER per evitare il loop RLS su profiles
-- (sarebbe self-referential se non bypassasse RLS).
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

-- last_modified_by_id preservato se gia' valorizzato (caso: Edge Function
-- che agisce per conto di un altro utente).
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

-- Soft-delete bloccato se esistono tx aperte: l'archiviazione e' irreversibile
-- via UI e perderebbe traccia del saldo. Difesa in profondita' rispetto al
-- nasconde-button lato UI.
create or replace function public.customers_protect_immutable()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  if new.id            is distinct from old.id            then raise exception 'customers.id is immutable';            end if;
  if new.qr_token      is distinct from old.qr_token      then raise exception 'customers.qr_token is immutable';      end if;
  if new.created_by_id is distinct from old.created_by_id then raise exception 'customers.created_by_id is immutable'; end if;
  if new.created_at    is distinct from old.created_at    then raise exception 'customers.created_at is immutable';    end if;

  if new.deleted_at is not null and old.deleted_at is null then
    if exists (
      select 1 from public.transactions
      where customer_id = new.id
        and paid = false
        and deleted_at is null
    ) then
      raise exception 'cannot archive customer with open transactions' using errcode = 'P0001';
    end if;
  end if;

  new.last_modified_by_id := auth.uid();
  new.last_modified_at    := now();
  return new;
end $$;

-- Immutabile tranne i 4 campi di pagamento. deleted_at NON modificabile via
-- UPDATE: cancellazione eccezionale richiede Edge Function (bypass RLS+trigger).
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

-- Storno SEMPRE TOTALE: amount(reversal) = amount(charge). L'unicita' di
-- reversal_of_id garantisce 1 storno max per charge.
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

-- FORCE: anche il table owner (postgres user delle migration) e' soggetto
-- alle policy. service_role mantiene il bypass via supabase_admin.

alter table public.profiles     enable row level security;
alter table public.profiles     force  row level security;

alter table public.customers    enable row level security;
alter table public.customers    force  row level security;

alter table public.transactions enable row level security;
alter table public.transactions force  row level security;

-- profiles INSERT/UPDATE/DELETE: tutto via Edge Functions con service_role.

drop policy if exists profiles_select_self         on public.profiles;
drop policy if exists profiles_select_admin_active on public.profiles;
drop policy if exists profiles_select_admin        on public.profiles;
drop policy if exists profiles_select_super_admin  on public.profiles;

create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = auth.uid());

-- admin vede solo operator (NON altri admin): separazione di privilegio.
create policy profiles_select_admin on public.profiles
  for select to authenticated
  using (public.is_admin() and role = 'operator');

create policy profiles_select_super_admin on public.profiles
  for select to authenticated
  using (public.is_super_admin());

drop policy if exists customers_select_active      on public.customers;
drop policy if exists customers_select_super_admin on public.customers;
drop policy if exists customers_select_admin       on public.customers;
drop policy if exists customers_insert             on public.customers;
drop policy if exists customers_update_attributes  on public.customers;
drop policy if exists customers_update_soft_delete on public.customers;

create policy customers_select_active on public.customers
  for select to authenticated
  using (deleted_at is null and public.is_operator_or_above());

create policy customers_select_admin on public.customers
  for select to authenticated
  using (public.is_admin_or_above());

create policy customers_insert on public.customers
  for insert to authenticated
  with check (
    public.is_operator_or_above()
    and created_by_id = auth.uid()
    and deleted_at is null
    and last_modified_by_id is null
    and last_modified_at is null
  );

create policy customers_update_attributes on public.customers
  for update to authenticated
  using (deleted_at is null and public.is_operator_or_above())
  with check (deleted_at is null);

create policy customers_update_soft_delete on public.customers
  for update to authenticated
  using (deleted_at is null and public.is_admin_or_above())
  with check (public.is_admin_or_above());

drop policy if exists transactions_select_active      on public.transactions;
drop policy if exists transactions_select_super_admin on public.transactions;
drop policy if exists transactions_insert             on public.transactions;
drop policy if exists transactions_update_close       on public.transactions;

create policy transactions_select_active on public.transactions
  for select to authenticated
  using (deleted_at is null and public.is_operator_or_above());

create policy transactions_select_super_admin on public.transactions
  for select to authenticated
  using (public.is_super_admin());

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

-- Postgres concede EXECUTE a PUBLIC su ogni function: revoke esplicito sotto
-- riduce la superficie /rest/v1/rpc segnalata dagli advisor Supabase.
-- authenticated mantiene EXECUTE su current_user_role (chiamata dalle policy
-- via is_admin/is_operator/...).
revoke execute on function public.current_user_role() from public, anon;

-- Trigger functions: invocate dal sistema, mai dai client.
revoke execute on function public.customers_protect_immutable()    from public, anon, authenticated;
revoke execute on function public.profiles_protect_immutable()     from public, anon, authenticated;
revoke execute on function public.transactions_protect_immutable() from public, anon, authenticated;
revoke execute on function public.transactions_validate_reversal() from public, anon, authenticated;
