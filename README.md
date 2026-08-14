# Kyora IQ — Funding Finder

A public, free list of grants and scholarships where someone opened
every link, plus live search across federal grants.

```
index.html      the page
data.json       the curated list
api/grants.js   forwards federal searches to Grants.gov
vercel.json     security headers and caching
```

## Why there is a function at all

Grants.gov sends no CORS headers, so a browser cannot call their API —
that is their choice and no amount of front-end code changes it.
`api/grants.js` makes the request server-side, where the rule does not
apply, and hands the result back.

It holds no secrets and touches no database. Grants.gov is public and
needs no key. The function exists only because of where the request
comes from.

## Deploying

1. Push this repository to GitHub
2. At vercel.com: **Add New → Project**, import the repo
3. Framework preset: **Other**. No build command, no output directory
4. Deploy

Every push to `main` redeploys. A custom domain is added under
**Settings → Domains**.

## Updating the list

From the Grant Hub project:

```
node scripts/export-public.mjs --out ../kyora-funding-finder/data.json
```

Then here:

```
git add -A && git commit -m "Update list" && git push
```

Live in about a minute.

Only records with a confirmed date are exported. Anything missing from
the site needs **Scan** or **Read page** in the Hub first — that gate
is the point, not an inconvenience.

## Running it locally

```
npx vercel dev
```

Opening `index.html` directly works for everything except the federal
tab, which needs the function running.
