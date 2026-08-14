/**
 * /api/grants
 *
 * Forwards a search to Grants.gov.
 *
 * The browser cannot call Grants.gov directly - their API sends no
 * CORS headers, which is their choice and not something a web page can
 * work around. This function makes the call server-side, where that
 * rule does not apply, and returns the result to the page.
 *
 * It holds no secrets and touches no database. Grants.gov is a public
 * API with no key; this exists solely because of where the request
 * originates.
 *
 * What it does do is narrow the surface: only a keyword goes through,
 * the response is reshaped to the few fields the page shows, and
 * results are cached briefly so a refresh does not become a request.
 */

const GRANTS_API = 'https://api.grants.gov/v1/api/search2'
const TIMEOUT_MS = 15_000
const MAX_ROWS = 25

/** Grants.gov returns MM/DD/YYYY. */
function isoDate(v) {
  if (!v) return null
  const m = String(v).match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[1]}-${m[2]}` : String(v).slice(0, 10)
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const keyword = String(req.query.q ?? '').trim().slice(0, 120)
  if (!keyword) {
    return res.status(400).json({ error: 'A search term is required' })
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const upstream = await fetch(GRANTS_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        // Some government APIs reject a request with no user agent.
        'User-Agent': 'KyoraIQ-FundingFinder/1.0',
      },
      body: JSON.stringify({
        keyword,
        rows: MAX_ROWS,
        oppStatuses: 'forecasted|posted',
        sortBy: 'openDate|desc',
      }),
      signal: controller.signal,
    })

    if (!upstream.ok) {
      return res.status(502).json({
        error: `Grants.gov returned ${upstream.status}`,
      })
    }

    const json = await upstream.json()
    const hits = json?.data?.oppHits ?? []

    // Only the fields the page renders. Passing the raw response
    // through would publish a shape we do not control and cannot
    // promise to keep working.
    const results = hits
      .filter(h => h.title)
      .map(h => ({
        title: String(h.title).slice(0, 300),
        number: h.number ? String(h.number).slice(0, 64) : null,
        agency: h.agencyName ? String(h.agencyName).slice(0, 160) : null,
        closeDate: isoDate(h.closeDate),
        url: h.id
          ? `https://www.grants.gov/search-results-detail/${encodeURIComponent(h.id)}`
          : 'https://www.grants.gov/search-grants',
      }))

    // Ten minutes at the edge. Federal listings do not change by the
    // minute, and a refresh should not cost Grants.gov a request.
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800')

    return res.status(200).json({
      count: results.length,
      total: json?.data?.hitCount ?? results.length,
      results,
    })
  } catch (err) {
    const aborted = err?.name === 'AbortError'
    return res.status(aborted ? 504 : 502).json({
      error: aborted ? 'Grants.gov did not respond in time' : 'Could not reach Grants.gov',
    })
  } finally {
    clearTimeout(timer)
  }
}
