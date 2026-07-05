// Vercel Serverless Function: /api/scores — žebříček (GET board / POST čas).
// Úložiště: Vercel KV (Upstash Redis REST) — env KV_REST_API_URL a
// KV_REST_API_TOKEN vzniknou automaticky připojením KV Storage k projektu
// ve Vercel dashboardu (Storage → Create → KV). Bez nich vrací 501.
// Stejná logika jako lokální middleware ve vite.config.js.

import crypto from 'node:crypto'

const KEY = '1p-island-run-scores'
const TOKEN_MAX_AGE_MS = 2 * 3600 * 1000 // token platí 2 h
const TIME_TOLERANCE_MS = 2500           // sklouz hodin / latence

// ── podepsaný session token (anti-cheat) ────────────────────────────
// Klíč je server-only env (nikdy v client bundlu). Token nese čas vydání;
// při ukládání ověříme, že od vydání uplynul aspoň naměřený čas → nelze
// poslat falešný „instantní" rekord přes curl.
function signToken(secret) {
  const issued = Date.now()
  const nonce = crypto.randomBytes(8).toString('hex')
  const sig = crypto.createHmac('sha256', secret).update(`${issued}.${nonce}`).digest('hex')
  return `${issued}.${nonce}.${sig}`
}
function verifyToken(secret, token, ms) {
  if (typeof token !== 'string') return 'missing'
  const parts = token.split('.')
  if (parts.length !== 3) return 'bad'
  const [issuedStr, nonce, sig] = parts
  const issued = parseInt(issuedStr, 10)
  if (!isFinite(issued)) return 'bad'
  const expected = crypto.createHmac('sha256', secret).update(`${issued}.${nonce}`).digest('hex')
  const a = Buffer.from(sig), b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return 'bad'
  const age = Date.now() - issued
  if (age < 0 || age > TOKEN_MAX_AGE_MS) return 'expired'
  if (age < ms - TIME_TOLERANCE_MS) return 'tooFast' // doběhl rychleji než token žije
  return 'ok'
}

function todayPrague() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague' }).format(new Date())
}
function sanitizeName(raw) {
  if (typeof raw !== 'string') return null
  const name = raw.replace(/[<>&"']/g, '').trim().slice(0, 24)
  return name.length >= 1 ? name : null
}
function bestPerPlayer(list) {
  const m = new Map()
  for (const s of list) {
    const b = m.get(s.name)
    if (!b || s.ms < b.ms) m.set(s.name, s)
  }
  return [...m.values()].sort((a, b) => a.ms - b.ms).slice(0, 10)
}
function boardPayload(store) {
  const today = todayPrague()
  const ath = store.scores.length
    ? store.scores.reduce((a, b) => (a.ms <= b.ms ? a : b))
    : null
  return {
    date: today,
    today: bestPerPlayer(store.scores.filter(s => s.date === today)),
    allTime: bestPerPlayer(store.scores),
    ath,
  }
}

async function kvGet(url, token) {
  const r = await fetch(`${url}/get/${KEY}`, { headers: { Authorization: `Bearer ${token}` } })
  const data = await r.json()
  if (!data.result) return { scores: [] }
  try { return JSON.parse(data.result) } catch { return { scores: [] } }
}
async function kvSet(url, token, store) {
  await fetch(`${url}/set/${KEY}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(store),
  })
}

export default async function handler(req, res) {
  // Vercel KV (classic) i marketplace Upstash integrace — různé názvy env
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) {
    res.status(501).json({ error: 'Žebříček není nakonfigurován (chybí Vercel KV / Upstash).' })
    return
  }

  // podpisový klíč: dedikovaný env, jinak KV token (taky server-only)
  const secret = process.env.SIGNING_SECRET || token

  if (req.method === 'GET') {
    if (req.query && req.query.session) {
      res.status(200).json({ token: signToken(secret) })
      return
    }
    const store = await kvGet(url, token)
    res.status(200).json(boardPayload(store))
    return
  }

  if (req.method === 'POST') {
    const { name: rawName, msRaw, dinos, token: runToken } = req.body || {}
    const name = sanitizeName(rawName)
    if (!name || typeof msRaw !== 'number' || !isFinite(msRaw) || msRaw < 3000 || msRaw > 3_600_000) {
      res.status(400).json({ error: 'Neplatné jméno nebo čas.' })
      return
    }
    // anti-cheat váže HRUBÝ čas (net může být díky bonusům mnohem nižší)
    const v = verifyToken(secret, runToken, msRaw)
    if (v !== 'ok') {
      const msg = v === 'tooFast' ? 'Čas neodpovídá délce hry.'
        : v === 'expired' ? 'Platnost kola vypršela, zahraj znovu.'
        : 'Kolo nelze ověřit, zahraj znovu.'
      res.status(403).json({ error: msg })
      return
    }
    const dinoCount = Math.max(0, Math.min(8, Math.floor(Number(dinos) || 0)))
    const ms = Math.max(0, Math.round(msRaw) - dinoCount * 10000) // net čas
    const store = await kvGet(url, token)
    store.scores.push({ name, ms, date: todayPrague(), ts: Date.now() })
    // pojistka proti nekonečnému růstu: drž max 5000 posledních záznamů
    if (store.scores.length > 5000) store.scores = store.scores.slice(-5000)
    await kvSet(url, token, store)
    res.status(200).json(boardPayload(store))
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
}
