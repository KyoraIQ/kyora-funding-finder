/**
 * /api/suggest
 *
 * Takes a suggestion from the public site.
 *
 * The only write path from the internet into this system, so the
 * checks matter more than the feature.
 *
 * WHAT IS CHECKED, AND WHY
 *
 *   A honeypot field. Real people never fill it in because they
 *   cannot see it; most bots fill in everything. Rejected silently -
 *   telling a bot it failed teaches it to try again differently.
 *
 *   The URL must parse, be http or https, and not point at a private
 *   address. Without that this becomes a way to make our server probe
 *   an internal network on someone else's behalf.
 *
 *   Rate limited by a HASH of the submitter's address, not the
 *   address. The same person can be counted without being recorded.
 *
 *   Lengths capped here and again in the database, so a body that
 *   slips past one is still rejected by the other.
 *
 * It writes with the ANON key, which can insert into one table and
 * read nothing back. Even a total compromise of this function gets
 * someone the ability to add rows to a review queue.
 */

import { createHash } from 'crypto'

const TIMEOUT_MS = 8_000
const MAX_PER_HOUR = 5

const PRIVATE_HOST = /^(localhost$|127\.|10\.|192\.168\.|169\.254\.|::1$|\[?::1\]?$|0\.)/i
const PRIVATE_172 = /^172\.(1[6-9]|2\d|3[01])\./

function badUrl(raw) {
  let u
  try { u = new URL(raw) } catch { return 'That does not look like a link.' }
  if (!/^https?:$/.test(u.protocol)) return 'Only http and https links can be submitted.'
  if (PRIVATE_HOST.test(u.hostname) || PRIVATE_172.test(u.hostname)) {
    return 'That address cannot be reached from here.'
  }
  if (u.hostname.length < 4 || !u.hostname.includes('.')) return 'That does not look like a link.'
  return null
}

/** Counts a person without identifying one. */
function hashSubmitter(req) {
  const fwd = req.headers['x-forwarded-for']
  const ip = (Array.isArray(fwd) ? fwd[0] : String(fwd ?? '')).split(',')[0].trim()
      || req.socket?.remoteAddress || 'unknown'
  const salt = process.env.SUGGEST_SALT ?? 'kyora-funding-finder'
  return createHash('sha256').update(salt + '|' + ip).digest('hex').slice(0, 32)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY
  const orgId = process.env.PUBLIC_ORG_ID

  if (!url || !key || !orgId) {
    return res.status(503).json({ error: 'Suggestions are not set up yet.' })
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body ?? {})

  // Silently accepted, never stored. A bot should learn nothing.
  if (String(body.website ?? '').trim() !== '') {
    return res.status(200).json({ ok: true })
  }

  const link = String(body.url ?? '').trim().slice(0, 600)
  const note = String(body.note ?? '').trim().slice(0, 600)

  if (!link) return res.status(400).json({ error: 'A link is required.' })
  const urlProblem = badUrl(link)
  if (urlProblem) return res.status(400).json({ error: urlProblem })

  const submitter = hashSubmitter(req)
  const rest = url.replace(/\/$/, '') + '/rest/v1'
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    // Rate check runs in the database, so calling this endpoint
    // directly does not bypass it.
    const rateRes = await fetch(`${rest}/rpc/suggestion_rate`, {
      method: 'POST', headers,
      body: JSON.stringify({ p_hash: submitter }),
      signal: controller.signal,
    })

    if (rateRes.ok) {
      const count = await rateRes.json()
      if (Number(count) >= MAX_PER_HOUR) {
        return res.status(429).json({
          error: 'That is several suggestions in a short time. Try again in an hour.',
        })
      }
    }

    const insert = await fetch(`${rest}/public_suggestions`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        organization_id: orgId,
        url: link,
        note: note || null,
        submitter_hash: submitter,
        user_agent: String(req.headers['user-agent'] ?? '').slice(0, 300) || null,
        status: 'new',
      }),
      signal: controller.signal,
    })

    if (insert.status === 409) {
      // Already suggested. Worth saying, since the person may have
      // spotted something genuinely useful that is simply in hand.
      return res.status(200).json({
        ok: true,
        message: 'Someone has already sent that one in - thank you, it is in the queue.',
      })
    }

    if (!insert.ok) {
      const text = await insert.text()
      console.error('[suggest] insert failed:', insert.status, text.slice(0, 200))
      return res.status(502).json({ error: 'That could not be saved. Try again shortly.' })
    }

    return res.status(200).json({ ok: true })
  } catch (err) {
    const aborted = err?.name === 'AbortError'
    return res.status(aborted ? 504 : 502).json({
      error: aborted ? 'That took too long. Try again.' : 'That could not be saved.',
    })
  } finally {
    clearTimeout(timer)
  }
}

function safeParse(s) {
  try { return JSON.parse(s) } catch { return {} }
}
