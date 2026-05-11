# Database setup

Schema PostgreSQL per Customer QR Tracker, applicabile a un progetto Supabase via SQL Editor della dashboard.

## Contenuto della cartella

| File | Scopo |
|---|---|
| `schema.sql` | Estensioni, enum, tabelle, CHECK constraint, indici, RPC pubblica. Idempotente. |
| `rls.sql` | Helper functions di ruolo, trigger, abilitazione RLS, policy. Idempotente. Da applicare DOPO `schema.sql`. |
| `promote-super-admin.sql.example` | Template per la creazione del primo super_admin. Va copiato in `promote-super-admin.sql`, sostituiti i placeholder e poi eseguito. La copia con i valori reali NON va committata (esclusa dal `.gitignore`). |

## Prerequisiti

- Progetto Supabase attivo (free tier sufficiente).
- Accesso allo SQL Editor della dashboard del progetto.
- Permessi di esecuzione DDL (proprietario del progetto).

## Ordine di applicazione

1. `schema.sql`
2. `rls.sql`
3. Registrare il primo utente in Supabase Auth (via dashboard, NON via SQL).
4. `promote-super-admin.sql` (copia di `promote-super-admin.sql.example` con i placeholder sostituiti).

Da qui in poi tutte le mutazioni privilegiate sui `profiles` avvengono via Edge Functions.

## Step 1 - Applica `schema.sql`

Apri il file in locale, copia tutto il contenuto e incollalo nello SQL Editor del progetto. Esegui (Run / Ctrl+Enter).

Lo script crea:

- estensione `pgcrypto`,
- enum `user_role`, `transaction_type`, `payment_method`,
- tabelle `profiles`, `customers`, `transactions`,
- CHECK constraint locali alle righe (amount positivo, paid coherence, reversal coherence),
- indice `transactions_customer_idx`,
- RPC pubblica `get_customer_qr_info(p_token text)` per la pagina `/qr/<token>`.

Verifiche (esegui in una query nuova):

```sql
-- enum creati:
select typname from pg_type
 where typname in ('user_role','transaction_type','payment_method');
-- atteso: 3 righe

-- tabelle create:
select tablename from pg_tables
 where schemaname='public'
   and tablename in ('profiles','customers','transactions');
-- atteso: 3 righe

-- indice creato:
select indexname from pg_indexes
 where schemaname='public' and tablename='transactions';
-- atteso: almeno transactions_customer_idx, transactions_pkey,
--         transactions_reversal_of_id_key

-- RPC pubblica raggiungibile (token finto, deve tornare 0 righe):
select * from public.get_customer_qr_info('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
-- atteso: 0 righe, nessun errore di permessi
```

OK se le verifiche passano. Lo schema e' idempotente: in caso di run parziale, basta rieseguirlo.

## Step 2 - Applica `rls.sql`

Apri il file, copia, incolla nello SQL Editor, esegui.

Lo script crea le helper functions di ruolo (`current_user_role`, `is_operator`, `is_admin`, `is_super_admin`, `is_admin_or_above`, `is_operator_or_above`), le 4 trigger functions, abilita+forza RLS sulle 3 tabelle e crea trigger e policy.

Verifiche:

```sql
-- RLS abilitato e forzato (forcerowsecurity vive in pg_class, non in pg_tables):
select c.relname             as tablename,
       c.relrowsecurity      as rowsecurity,
       c.relforcerowsecurity as forcerowsecurity
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('profiles','customers','transactions');
-- atteso: 3 righe con rowsecurity=t e forcerowsecurity=t

-- policy attive (cast il literal a regclass per evitare gotcha
-- legati al search_path):
select polrelid::regclass as tabella, polname, polcmd
  from pg_policy
 where polrelid in (
       'public.profiles'::regclass,
       'public.customers'::regclass,
       'public.transactions'::regclass
       )
 order by polrelid::regclass::text, polname;
-- atteso: 3 policy su profiles, 5 su customers, 4 su transactions

-- trigger attivi (esclusi quelli interni):
select tgname, tgrelid::regclass
  from pg_trigger
 where tgrelid in (
       'public.profiles'::regclass,
       'public.customers'::regclass,
       'public.transactions'::regclass
       )
   and not tgisinternal;
-- atteso: 4 trigger
--   profiles_before_update
--   customers_before_update
--   transactions_before_update
--   transactions_before_insert
```

NB: dopo questo step, il ruolo `anon` non puo' piu' leggere/scrivere nulla nelle 3 tabelle (a parte la RPC pubblica). Anche `authenticated` senza una riga in `profiles` collegata e' bloccato. Per sbloccare il primo accesso applicativo serve creare il primo profilo (Step 3-4).

## Step 3 - Registra il primo utente in Supabase Auth

Da dashboard, NON via SQL.

1. Apri la sezione `Auth -> Users` del progetto.
2. `Add user` -> `Create new user`.
3. Inserisci email + password (saranno le credenziali del primo super_admin).
4. Conferma. Annota l'`UUID` generato per l'utente: serve allo Step 4.

WARN: spunta `Auto Confirm User` se non vuoi gestire la conferma email per il super_admin.

## Step 4 - Promuovi il primo super_admin

Crea la riga in `profiles` con `role='super_admin'` per l'utente registrato allo Step 3. Senza questa riga, l'utente puo' fare login ma RLS lo blocca su tutte le tabelle.

1. Copia `promote-super-admin.sql.example` in `promote-super-admin.sql` (senza `.example`). Il `.gitignore` esclude la copia con i valori reali.
2. Apri la copia, sostituisci i placeholder:
   - `<UUID-DA-AUTH-USERS>` -> UUID copiato dallo Step 3.
   - `<NOME>` e `<COGNOME>` -> nome e cognome del super_admin.
3. Copia il contenuto, incolla nello SQL Editor, esegui.

Verifica:

```sql
select id, first_name, last_name, role, created_at
  from public.profiles
 where role = 'super_admin';
-- atteso: 1 riga con l'UUID corretto
```

NB: `<UUID-DA-AUTH-USERS>` non e' un UUID valido, quindi se uno dei placeholder non viene sostituito lo script fallisce subito con un errore di sintassi. Voluto: nessuna esecuzione "a vuoto".

## Step 5 - Da qui in poi via Edge Functions

Tutte le mutazioni successive sui `profiles` (creazione admin/operator, cambio ruolo, soft-delete, reset password) avvengono via Edge Functions privilegiate (codice Deno in `supabase/functions/<name>/`). Vedi le specifiche del progetto per la lista completa.

Finche' le Edge Functions non sono pronte, l'unico modo per creare ulteriori utenti e' ripetere manualmente Step 3 + uno script analogo a `promote-super-admin.sql` con `role='admin'` o `role='operator'`. Va bene per i primi smoke test, non per produzione.

## Reset

### Wipe parziale (mantieni Auth, riapplica schema)

WARN: cancella tutti i dati delle 3 tabelle. Auth resta intatto (gli utenti registrati restano).

```sql
drop table if exists public.transactions cascade;
drop table if exists public.customers    cascade;
drop table if exists public.profiles     cascade;
drop type  if exists public.user_role        cascade;
drop type  if exists public.transaction_type cascade;
drop type  if exists public.payment_method   cascade;
drop function if exists public.get_customer_qr_info(text);
drop function if exists public.current_user_role();
drop function if exists public.is_operator();
drop function if exists public.is_admin();
drop function if exists public.is_super_admin();
drop function if exists public.is_admin_or_above();
drop function if exists public.is_operator_or_above();
drop function if exists public.profiles_protect_immutable();
drop function if exists public.customers_protect_immutable();
drop function if exists public.transactions_protect_immutable();
drop function if exists public.transactions_validate_reversal();
```

Poi ri-esegui Step 1 e Step 2.

### Wipe totale (incluso Auth)

Da dashboard del progetto: `Settings -> General -> Reset database`. Cancella tutto: tabelle, dati, utenti Auth. Dopo, ricomincia dallo Step 1.

## Setup multi-ambiente (M8 Sub-D, 2026-05-10)

Da M8 il progetto vive in due ambienti distinti, ognuno col proprio Supabase project.

| Ambiente | Worker URL | Supabase project ref | Branch git |
|---|---|---|---|
| PRD | https://anotherbeachproject.sovereto.workers.dev | `xccpopnwqrxjjhrtyiwd` | `main` |
| DEV | https://anotherbeachproject-dev.sovereto.workers.dev | `esxnberopfmfaebmbqwd` | `develop` |

### Provisioning di un nuovo ambiente da zero

1. Dashboard Supabase: New project. Region uguale a PRD (eu-west-1).
2. SQL editor del nuovo project: applicare `schema.sql` poi `rls.sql` (in ordine, idempotenti). Vedi Step 1 e Step 2.
3. Auth -> Users -> Add user: creare `auth.users` per gli admin/super_admin desiderati (Auto Confirm User ON).
4. SQL editor: INSERT in `profiles` con UUID degli `auth.users` appena creati e `role` opportuno.
5. Verify: `select * from profiles;` mostra le righe attese; dashboard Advisors -> Security: 0 finding HIGH/CRITICAL.
6. Configurare il Worker Cloudflare puntando alle env vars `SUPABASE_URL` + `SUPABASE_ANON_KEY` del nuovo project (Settings -> Build -> Variables and Secrets sul Worker).

### Convenzione di sync DDL DEV<->PRD

Ogni cambio a `schema.sql` o `rls.sql` viene applicato a ENTRAMBI gli ambienti nello stesso turno via:
- `mcp__supabase__apply_migration` per il project bound dal MCP (oggi PRD), oppure
- Management API curl con PAT account-wide su `https://api.supabase.com/v1/projects/<ref>/database/query` (header User-Agent custom per evitare WAF Cloudflare 1010), oppure
- SQL editor della dashboard del project di destinazione (manuale).

DEV per primo, poi PRD se il primo apply e' verde. Niente drift accettabile fra i due ambienti per piu' di una sessione di lavoro.

### Branch protection

Free tier GitHub non permette branch protection rules su repo private. Convenzione: niente push diretto su `main`, solo PR da `develop`. Enforcement = autodisciplina del solo dev. Se in futuro il repo diventa public o si paga GitHub Pro, riabilitare branch protection via `gh api repos/.../branches/main/protection`.

## Recovery da backup R2 (M8 Sub-C, 2026-05-10)

I backup giornalieri vivono su Cloudflare R2 (`anotherbeach-backups`, lifecycle 90gg). Layout: `<YYYY-MM-DD>/<table>.csv` (3 tabelle: customers, transactions, profiles).

### Procedura di recovery (manuale, ~30 min)

Pre-condizione: avere accesso alla dashboard Cloudflare e Supabase, avere localmente `psql` installato.

1. **Scaricare i 3 CSV dalla data target dal bucket R2.**
   Dashboard R2 -> bucket `anotherbeach-backups` -> selezionare folder data -> download di customers.csv, transactions.csv, profiles.csv.

2. **Decidere il project di destinazione.**
   - Recovery in-place su PRD: si applica direttamente al project esistente (rischio: distruzione dati attuali; di norma sconsigliato, si crea un project fresh).
   - Recovery su project nuovo: dashboard Supabase -> New project (es. `AnotherBeachToken-recovery-<date>`).

3. **Applicare schema + RLS sul project di destinazione.**
   SQL editor del project di destinazione: copiare e applicare `repo/sql/schema.sql` poi `repo/sql/rls.sql`.

4. **Ottenere il connection string Session Pooler del project di destinazione.**
   Dashboard project -> Settings -> Database -> Connection string -> Session pooler. Sostituire la password.

5. **Caricare i CSV in ordine.**
   L'ordine e' determinato dalle FK: profiles (referenziato da customers), customers (referenziato da transactions), transactions.

   Da terminale locale (PowerShell):
   ```
   $env:DEST_DB_URL = "postgresql://postgres.<ref>:<pwd>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres"
   psql "$env:DEST_DB_URL" -c "\copy public.profiles    FROM 'profiles.csv'    WITH (FORMAT csv, HEADER)"
   psql "$env:DEST_DB_URL" -c "\copy public.customers   FROM 'customers.csv'   WITH (FORMAT csv, HEADER)"
   psql "$env:DEST_DB_URL" -c "\copy public.transactions FROM 'transactions.csv' WITH (FORMAT csv, HEADER)"
   ```

   Expected: ogni comando ritorna `COPY <N>` dove N = righe attese.

6. **Ricreare gli `auth.users` mancanti.**
   `auth.users` non e' nel backup (vedi SPEC sez 11). Per ogni `profiles.id` che ha bisogno di login: dashboard project -> Auth -> Users -> Add user con stesso UUID e password temporanea. Comunicare agli utenti di cambiare password al primo login.

7. **Smoke test.**
   Login come super_admin del project di destinazione (puo' essere uno qualunque dei profile super_admin restorati, dopo aver creato il corrispondente auth.users). Verificare che lista clienti sia popolata, che si possa fare un addebito di prova.

### Verifica annuale

A inizio stagione il super_admin esegue un dry-run di recovery sul progetto **DEV** (riusato come "Supabase project secondario" della SPEC sez 10). Procedura:

1. Scaricare i 3 CSV dell'ultimo backup PRD da R2.
2. Su DEV: pulizia totale via `/admin/season` reset (azzera customers + transactions; profiles intatto).
3. Applicare la procedura di recovery (step 5-7) usando Session Pooler DEV come destinazione.
4. Verificare counts post-restore == counts del backup (`select count(*) from customers;` su DEV deve coincidere con il numero di righe in customers.csv meno header).
5. Reset di nuovo via `/admin/season` per pulire DEV.

Tempo medio: 30-45 min, tutti gli step manuali.
