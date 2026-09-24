# Deploying to Oracle Cloud Always-Free VM + Vercel + Cloudflare

This runs the API, scraper worker, Postgres, Redis, and OpenSearch on one Oracle
Cloud "Always Free" VM, exposed to the internet only through a Cloudflare
Tunnel (no inbound firewall ports needed). The Next.js frontend deploys
separately to Vercel.

## 1. Create the Oracle Cloud VM

1. Sign up at https://cloud.oracle.com/ (free tier, requires identity verification).
2. Create a compute instance:
   - Shape: **VM.Standard.A1.Flex** (Ampere ARM) — up to 4 OCPU / 24GB RAM is
     within the Always Free limits. 2 OCPU / 12GB is plenty to start.
   - Image: Ubuntu 22.04 or later (ARM build).
   - Add your SSH public key during creation.
3. In the VM's subnet security list, you do **not** need to open any inbound
   ports beyond SSH (22) — Cloudflare Tunnel makes an outbound-only connection.
4. SSH in and install Docker:
   ```bash
   sudo apt-get update && sudo apt-get install -y docker.io docker-compose-plugin git
   sudo usermod -aG docker $USER   # log out/in after this
   ```
5. Clone the repo onto the VM:
   ```bash
   git clone <your-repo-url> peoplefinder
   cd peoplefinder/infra/oracle-vm
   cp .env.example .env   # then edit with real secrets
   ```

## 2. Set up the Cloudflare Tunnel

1. Add your domain to Cloudflare (free plan) if you haven't already.
2. On the VM (or your laptop, then copy the two generated files over):
   ```bash
   curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 -o cloudflared
   chmod +x cloudflared && sudo mv cloudflared /usr/local/bin/
   cloudflared tunnel login
   cloudflared tunnel create peoplefinder-api
   ```
   This prints a tunnel UUID and writes a credentials JSON file
   (usually `~/.cloudflared/<UUID>.json`).
3. Copy the credentials file into `infra/oracle-vm/cloudflared/` on the VM.
4. Copy `cloudflared/config.yml.example` to `cloudflared/config.yml` and fill
   in the tunnel UUID and credentials file path (see comments in the file).
5. Route DNS to the tunnel:
   ```bash
   cloudflared tunnel route dns peoplefinder-api api.yourdomain.com
   ```

## 3. Bring the stack up

```bash
cd infra/oracle-vm
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml exec api alembic revision --autogenerate -m "init schema"
docker compose -f docker-compose.prod.yml exec api alembic upgrade head
```

`api.yourdomain.com` should now serve the FastAPI app through Cloudflare, with
TLS handled automatically by Cloudflare — no certbot/Let's Encrypt needed on
the VM itself.

For future deploys, just run `./deploy.sh` from this directory.

## 4. Deploy the frontend to Vercel

1. Import the repo into Vercel, set the project root to `apps/web`.
2. Set the environment variable `NEXT_PUBLIC_API_BASE_URL=https://api.yourdomain.com`.
3. Deploy. Vercel gives you `your-app.vercel.app` plus the option to attach a
   custom domain (can also be proxied through Cloudflare for one consistent DNS zone).
4. Update `API_CORS_ORIGINS` in the VM's `.env` to include the real Vercel/custom
   domain, then re-run `docker compose -f docker-compose.prod.yml up -d` to
   pick up the change.

## Notes / limits

- Always-Free Ampere A1 allowance is 4 OCPU + 24GB RAM total across instances —
  don't oversize the VM or you'll start incurring charges.
- Back up the `postgres-data` volume regularly (Oracle Always Free has no
  managed backup service) — a simple cron running `pg_dump` to Object Storage
  (also has an Always Free quota) works well.
- Cloudflare's free plan covers TLS, CDN, and basic WAF/rate-limiting rules —
  configure rate limiting on `/search` and `/persons/*` before opening this up
  publicly to control scraping/abuse of your own API.
