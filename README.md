# People Finder Platform (working name TBD)

Public-records / people-search platform: search aggregation, court/business record lookups,
and a paid tier for detailed reports.

## Monorepo layout

```
apps/
  api/        FastAPI backend (search, persons, auth, payments, opt-out)
  web/        Next.js frontend (search UI, results, person detail, checkout)
services/
  scrapers/   Node/TS crawler workers (BullMQ queue, source connectors)
infra/
  terraform/  GCP + Cloudflare infrastructure as code (alternate path, not yet applied)
  oracle-vm/  Production deploy: Oracle Cloud free VM (API/worker/DB) + Cloudflare Tunnel
```

## Local development

Requirements: Docker Desktop, Node 20+, Python 3.12+.

```powershell
copy .env.example .env
docker compose up -d postgres redis opensearch
# API
cd apps/api; pip install -r requirements.txt; alembic upgrade head; uvicorn app.main:app --reload
# Scraper worker
cd services/scrapers; npm install; npm run dev
# Frontend
cd apps/web; npm install; npm run dev
```

## Production deployment

Current plan: Next.js frontend on Vercel, everything else (Postgres, Redis, OpenSearch,
API, scraper worker) on a single Oracle Cloud "Always Free" VM, exposed via a Cloudflare
Tunnel. See [infra/oracle-vm/README.md](infra/oracle-vm/README.md) for the full setup guide.

## Design notes

- Payments start with PayPal but sit behind a `PaymentProvider` interface so another
  processor can be swapped in later without touching business logic.
- Scraper connectors only target sources that are genuinely public and don't require
  bypassing authentication or bot-detection (see `services/scrapers/src/connectors`).
  Do not add connectors that log into social platforms or solve CAPTCHAs.
- Compliance (opt-out portal, permissible-purpose gating, full audit trail) is
  intentionally minimal right now per product decision — `optout_requests` and
  `search_audit_log` tables exist as groundwork but are not enforced end-to-end yet.
