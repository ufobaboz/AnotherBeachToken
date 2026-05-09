# E2E - Customer QR Tracker

Test end-to-end con Playwright. Target di default: produzione live (`https://anotherbeachproject.sovereto.workers.dev`).

## Stack

- `@playwright/test` con browser `chromium`.
- `typescript` (default Playwright).
- `workers: 1` (un solo super_admin di test, no parallelismo).
- Trace + screenshot + video on failure.
- Niente test runner globale, niente coverage: smoke E2E mirati.

## Prerequisiti

Variabili d'ambiente (in `.env` locale, in GitHub Secrets per CI):

| Var | Default | Note |
|---|---|---|
| `APP_URL` | `https://anotherbeachproject.sovereto.workers.dev` | Override per testare branch preview (es. `https://m5-feat-anotherbeachproject.sovereto.workers.dev`). |
| `TEST_SUPER_ADMIN_EMAIL` | -- | Email di un super_admin esistente nel DB target. |
| `TEST_SUPER_ADMIN_PASSWORD` | -- | Password relativa. |

I test creano clienti con `last_name` formato `ZZ-E2E-<rand>` e li soft-delete a teardown. Le `transactions` collegate restano in DB con `paid=true` su cliente soft-deleted: la pulizia totale avviene a fine stagione via `reset-season` (M8). Ok come scelta per il free tier mono-tenant.

## Setup locale

```
cd C:/Users/Utente/Desktop/abt/repo/e2e
npm ci
npx playwright install chromium
$env:TEST_SUPER_ADMIN_EMAIL = "..."   # PowerShell
$env:TEST_SUPER_ADMIN_PASSWORD = "..."
npm test
```

(Su Linux/macOS sostituire `$env:VAR = "..."` con `export VAR=...`.)

## Setup CI (GitHub Actions)

1. Repo Settings -> Secrets and variables -> Actions -> New repository secret.
2. Aggiungi `TEST_SUPER_ADMIN_EMAIL` e `TEST_SUPER_ADMIN_PASSWORD`.
3. Workflow `.github/workflows/e2e.yml` parte automaticamente su push a `main` quando cambiano `public/`, `src/` o `e2e/`.
4. Trigger manuale: `Actions -> E2E -> Run workflow`.

## Aggiunta di una milestone

Per ogni milestone successiva si aggiunge `specs/<milestone>-<feature>.spec.ts` con scope la DoD di quella milestone. Le helper in `helpers/` sono condivise.

## Gotcha note

- `workers: 1` perche' il super_admin di test e' uno solo: due test in parallelo che fanno login concorrente romperebbero lo stato locale del browser, e il flow includes mutazioni DB.
- Phone format del test: `+39000<7-digits>` per non collidere con telefoni reali italiani.
- Cleanup: `try/finally` con `softDeleteTestCustomer`. Se il test crasha al teardown lascia residui (verificabili con `select * from customers where last_name like 'ZZ-E2E-%'` da MCP supabase).
