/**
 * /api/list
 *
 * Reads the curated list live from the public database view.
 *
 * WHY THIS IS SAFE
 *
 * It reads one view, `public_funding`, which emits confirmed rows and
 * publishable columns only. Every other table is unreachable from the
 * key used here.
 *
 * That key is the Supabase ANON key, which is designed to be public -
 * the Grant Hub already ships it to every browser that loads it. The
 * security lives in the view definition and row level security, not
 * in keeping the key hidden. The service role key, which does bypass
 * those, is never used here and must never be added to this project.
 *
 * The function exists rather than calling Supabase from the page for
 * two reasons: it keeps the project URL out of the page source, and
 * it lets the response be cached at the edge so a busy day does not
 * become a busy day for the database.
 */

const TIMEOUT_MS = 8_000

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY

  if (!url || !key) {
    // The page falls back to its shipped copy, so this is not fatal.
    return res.status(503).json({ error: 'Live list not configured' })
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const endpoint =
      `${url.replace(/\/$/, '')}/rest/v1/public_funding` +
      '?select=name,url,focus,notes,award,timing,fee,geography,checked_on,audience'

    const upstream = await fetch(endpoint, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    })

    if (!upstream.ok) {
      return res.status(502).json({ error: `Upstream returned ${upstream.status}` })
    }

    const raw = await upstream.json()

    // Rename to what the page expects, and drop anything without the
    // two fields that make a row useful.
    const rows = (Array.isArray(raw) ? raw : [])
      .filter(r => r.name && r.url)
      .map(r => ({
        name: r.name,
        url: r.url,
        focus: r.focus ?? null,
        notes: r.notes ?? null,
        award: r.award ?? null,
        timing: r.timing ?? null,
        fee: r.fee ?? null,
        geography: r.geography ?? null,
        checkedOn: r.checked_on ?? null,
        audience: r.audience === 'business' ? 'business' : 'individual',
      }))
      // Belt and braces. The view already guarantees this; if it ever
      // stopped, the site's central claim should not quietly break.
      .filter(r => r.checkedOn)

    // Five minutes at the edge. Long enough that traffic does not
    // reach the database repeatedly, short enough that a check made
    // this morning is visible by lunch.
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600')

    return res.status(200).json({ count: rows.length, rows })
  } catch (err) {
    const aborted = err?.name === 'AbortError'
    return res.status(aborted ? 504 : 502).json({
      error: aborted ? 'Timed out' : 'Could not reach the list',
    })
  } finally {
    clearTimeout(timer)
  }
}
