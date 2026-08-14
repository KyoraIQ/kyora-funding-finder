# Live list — setup

The site reads the curated list from a database view, with the shipped
`data.json` as a fallback.

## 1. Run migration 040 in Supabase

Creates `public_funding` — the only thing the public site can read.
Confirmed rows, publishable columns, business funding and cyber
scholarships. Everything else is unreachable.

## 2. Add two environment variables in Vercel

**Settings → Environment Variables**, for Production and Preview:

| Name | Value |
|---|---|
| `SUPABASE_URL` | your project URL |
| `SUPABASE_ANON_KEY` | the **anon** key |

The anon key is meant to be public — the Grant Hub already ships it to
every browser. Security comes from the view definition and row level
security, not from hiding it.

**Never add the service role key here.** It bypasses row level
security entirely, and nothing in this project needs it.

## 3. Redeploy

Vercel picks up new variables on the next deployment. Push anything,
or use **Deployments → Redeploy**.

## Checking it worked

Open `/api/list` on the deployed site. You should see JSON with a
`count` and a `rows` array.

If the site shows an amber "most recently published copy" line, the
live read failed and the fallback is being used — check the variables
and the migration.

## What happens now

Check something in the Grant Hub and it appears here within five
minutes, which is the edge cache. No export, no commit, no deploy.

`data.json` only updates when you run the export and push, and it
exists purely so the site still works if Supabase is unreachable.
