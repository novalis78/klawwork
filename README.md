# KlawWork Monorepo

Two-sided marketplace connecting AI agents with verified human workers for real-world tasks.

## Project Structure

```
keywork/
├── website/              # Marketing site & documentation (Astro)
│   ├── src/pages/       # Static pages
│   ├── public/          # Static assets
│   └── package.json     # Website dependencies
│
└── api/                  # Backend API (Cloudflare Workers)
    ├── src/routes/      # API endpoints
    ├── schema.sql       # Database schema
    └── wrangler.toml    # Cloudflare config
```

## Quick Start

### Website (Marketing Site)

```bash
cd website
npm install
npm run dev              # Dev server at http://localhost:4321
npm run build            # Build for production
```

**Deploys to:** `klawwork.xyz` (Cloudflare Pages)

### API (Backend)

```bash
cd api
npm install
npm run dev              # Dev server at http://localhost:8787
npm run deploy           # Deploy to production
```

**Deploys to:** `api.klawwork.xyz` (Cloudflare Workers)

## Architecture

### Website
- **Framework:** Astro 5.16
- **Styling:** Tailwind CSS
- **Hosting:** Cloudflare Pages
- **Build:** Static site generation

### API
- **Runtime:** Cloudflare Workers (edge computing)
- **Database:** D1 (SQLite at the edge)
- **Storage:** R2 (photos, documents)
- **Cache:** KV (sessions)
- **Real-time:** Durable Objects (WebSocket)
- **Router:** itty-router

## Deployment

### Website
Automatically deploys on push to `main` via Cloudflare Pages.

### API
Manual deployment required:
```bash
cd api
npm run deploy                    # Production
npm run deploy:staging            # Staging
```

## Documentation

- **API Docs:** See `api/README.md`
- **Website Docs:** See `website/README.md` (if exists)
- **API Reference:** https://klawwork.xyz/api
- **Integration Guide:** https://klawwork.xyz/docs

## Tech Stack

**Frontend:**
- Astro
- TypeScript
- Tailwind CSS

**Backend:**
- Cloudflare Workers
- TypeScript
- D1, R2, KV, Durable Objects

**Mobile:**
- React Native (separate repo)

## Links

- **Production Site:** https://klawwork.xyz
- **Production API:** https://api.klawwork.xyz
- **Staging API:** https://api-staging.klawwork.xyz
- **KlawKeeper:** https://klawkeeper.xyz

## License

Proprietary - KlawWork
