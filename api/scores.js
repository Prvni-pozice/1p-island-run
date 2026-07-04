// Vercel Serverless Function: /api/scores — žebříček (GET board / POST čas).
// Úložiště: Vercel KV (Upstash Redis REST) — env KV_REST_API_URL a
// KV_REST_API_TOKEN vzniknou automaticky připojením KV Storage k projektu
// ve Vercel dashboardu (Storage → Create → KV). Bez nich vrací 501.
// Stejná logika jako lokální middleware ve vite.config.js.

const KEY = '1p-island-run-scores'

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
  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  if (!url || !token) {
    res.status(501).json({ error: 'Žebříček není nakonfigurován (chybí Vercel KV).' })
    return
  }

  if (req.method === 'GET') {
    const store = await kvGet(url, token)
    res.status(200).json(boardPayload(store))
    return
  }

  if (req.method === 'POST') {
    const { name: rawName, ms } = req.body || {}
    const name = sanitizeName(rawName)
    if (!name || typeof ms !== 'number' || !isFinite(ms) || ms < 3000 || ms > 3_600_000) {
      res.status(400).json({ error: 'Neplatné jméno nebo čas.' })
      return
    }
    const store = await kvGet(url, token)
    store.scores.push({ name, ms: Math.round(ms), date: todayPrague(), ts: Date.now() })
    // pojistka proti nekonečnému růstu: drž max 5000 posledních záznamů
    if (store.scores.length > 5000) store.scores = store.scores.slice(-5000)
    await kvSet(url, token, store)
    res.status(200).json(boardPayload(store))
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
}
