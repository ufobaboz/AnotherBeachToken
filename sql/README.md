# Database setup

Schema PostgreSQL per Customer QR Tracker, applicabile a un progetto Supabase via SQL Editor della dashboard.

## Contenuto della cartella

| File | Scopo |
|---|---|
| `schema.sql` | Estensioni, enum, tabelle, CHECK constraint, indici, RPC pubblica. Idempotente. |
| `rls.sql` | Helper functions di ruolo, trigger, abilitazione RLS, policy. Idempotente. Da applicare DOPO `schema.sql`. |
| `promote-super-admin.sql.example` | Template per la creazione del primo super_admin. Va copiato in `promote-super-admin.sql`, sostituiti i placeholder e poi eseguito. La copia con i valori reali NON va committata (esclusa dal `.gitignore`). |
| `e2e-cleanup.sql` | DEV ONLY. Function `_e2e_bulk_cleanup()` per hard delete dei dati Playwright. Idempotente. NON applicare su PRD. |

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

## Restore da R2 (disaster recovery)

I backup CSV pg-native vivono su Cloudflare R2 bucket `abt-backups-prd` con questo layout:

```
abt-backups-prd/
  daily/YYYY-MM-DD/<table>.csv          # daily, retention 90 giorni
  daily/YYYY-MM-DD/<table>.ita.csv      # variante ITA-friendly (non per restore)
  season-end/YYYY-MM-DD/<table>.csv     # snapshot pre-TRUNCATE, retention indefinita
```

Procedura di restore (~30 min su Supabase project di destinazione vuoto):

```bash
# 0. Variabili (esempio)
export R2_BUCKET=abt-backups-prd
export R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
export AWS_ACCESS_KEY_ID=<token_r2>
export AWS_SECRET_ACCESS_KEY=<token_r2_secret>
export AWS_DEFAULT_REGION=auto
export SUPABASE_DB_URL_FRESH="postgresql://postgres:<pwd>@db.<ref>.supabase.co:5432/postgres"

# 1. Scaricare i 3 CSV pg-native dal prefix corretto.
# Restore end-of-season (target piu' tipico):
aws s3 cp "s3://$R2_BUCKET/season-end/2026-09-30/" ./restore/ \
  --recursive --endpoint-url "$R2_ENDPOINT"

# Restore daily piu' recente (alternativa: cancellare *.ita.csv perche'
# non re-importabili):
aws s3 cp "s3://$R2_BUCKET/daily/2026-05-11/" ./restore/ \
  --recursive --endpoint-url "$R2_ENDPOINT" --exclude "*.ita.csv"

# 2. Applicare schema + RLS sul project di destinazione.
psql "$SUPABASE_DB_URL_FRESH" -f schema.sql
psql "$SUPABASE_DB_URL_FRESH" -f rls.sql

# 3. Restore in ordine FK-aware: profiles -> customers -> transactions.
psql "$SUPABASE_DB_URL_FRESH" -c \
  "\copy public.profiles    FROM 'restore/profiles.csv'    WITH (FORMAT csv, HEADER)"
psql "$SUPABASE_DB_URL_FRESH" -c \
  "\copy public.customers   FROM 'restore/customers.csv'   WITH (FORMAT csv, HEADER)"
psql "$SUPABASE_DB_URL_FRESH" -c \
  "\copy public.transactions FROM 'restore/transactions.csv' WITH (FORMAT csv, HEADER)"

# 4. Ricreare gli utenti auth.users con gli stessi UUID. Le credenziali
#    Auth NON sono in R2: gli UUID si rileggono dalla colonna profiles.id e
#    si ricreano in Supabase Auth con password temporanee da comunicare
#    fuori app (Admin API o dashboard).

# 5. Smoke test: login del super_admin, scarica un report, fa un addebito di prova.
```

I file `*.ita.csv` (ITA-friendly: separator `;`, BOM, date `dd/MM/yyyy HH:mm`,
anti-formula-injection) NON sono re-importabili via `\copy ... FROM`. Servono
solo per ispezione visiva del backup. Per il restore tecnico usare sempre i
`*.csv` (pg-native).

Note operative:
- `aws` CLI parla con R2 via API S3-compatible (endpoint = `$R2_ENDPOINT`,
  credenziali = token R2 esposti come `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`).
  Niente AWS sotto.
- Il bucket DEV `abt-backups-dev` ha la stessa struttura ed e' usato solo dai
  test E2E che esercitano la edge function `reset-season`. Niente daily
  backup su DEV.
- Lifecycle `expire-daily-90d` cancella `daily/*` dopo 90 giorni. `season-end/*`
  non ha lifecycle: snapshot indefinito.
