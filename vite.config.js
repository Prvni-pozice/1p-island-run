import { defineConfig } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

// ── anti-cheat token (stejná logika jako Vercel api/scores.js) ──────
// Lokální podpisový klíč platí v rámci běhu serveru (restart = nová sada
// tokenů; pro testovací VPS dostačuje).
const SIGN_SECRET = crypto.randomBytes(32).toString('hex')
const TOKEN_MAX_AGE_MS = 2 * 3600 * 1000
const TIME_TOLERANCE_MS = 2500

function signToken() {
  const issued = Date.now()
  const nonce = crypto.randomBytes(8).toString('hex')
  const sig = crypto.createHmac('sha256', SIGN_SECRET).update(`${issued}.${nonce}`).digest('hex')
  return `${issued}.${nonce}.${sig}`
}
function verifyToken(token, ms) {
  if (typeof token !== 'string') return 'missing'
  const parts = token.split('.')
  if (parts.length !== 3) return 'bad'
  const [issuedStr, nonce, sig] = parts
  const issued = parseInt(issuedStr, 10)
  if (!isFinite(issued)) return 'bad'
  const expected = crypto.createHmac('sha256', SIGN_SECRET).update(`${issued}.${nonce}`).digest('hex')
  const a = Buffer.from(sig), b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return 'bad'
  const age = Date.now() - issued
  if (age < 0 || age > TOKEN_MAX_AGE_MS) return 'expired'
  if (age < ms - TIME_TOLERANCE_MS) return 'tooFast'
  return 'ok'
}

// ── Lokální /api/scores (dev i preview server) ──────────────────────
// Stejné API jako Vercel funkce v /api/scores.js — hra volá relativní
// URL, takže funguje beze změny lokálně na VPS i po deployi na Vercel.
const DATA_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'scores.json')

function readStore() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) } catch { return { scores: [] } }
}
function writeStore(d) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true })
  fs.writeFileSync(DATA_FILE, JSON.stringify(d))
}
function todayPrague() {
  // sv-SE locale → YYYY-MM-DD
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

const rateMap = new Map() // ip → [timestamps]
function rateLimited(ip) {
  const now = Date.now()
  const arr = (rateMap.get(ip) || []).filter(t => now - t < 60_000)
  arr.push(now)
  rateMap.set(ip, arr)
  return arr.length > 12
}

function scoresMiddleware(req, res, next) {
  if (!req.url.startsWith('/api/scores')) return next()
  res.setHeader('Content-Type', 'application/json; charset=utf-8')

  if (req.method === 'GET') {
    if (req.url.includes('session=')) {
      res.end(JSON.stringify({ token: signToken() }))
      return
    }
    res.end(JSON.stringify(boardPayload(readStore())))
    return
  }
  if (req.method === 'POST') {
    if (rateLimited(req.socket.remoteAddress || '?')) {
      res.statusCode = 429
      res.end(JSON.stringify({ error: 'Příliš mnoho pokusů, zkus to za chvíli.' }))
      return
    }
    let body = ''
    req.on('data', c => { body += c; if (body.length > 4096) req.destroy() })
    req.on('end', () => {
      try {
        const { name: rawName, ms, token: runToken } = JSON.parse(body)
        const name = sanitizeName(rawName)
        if (!name || typeof ms !== 'number' || !isFinite(ms) || ms < 3000 || ms > 3_600_000) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: 'Neplatné jméno nebo čas.' }))
          return
        }
        const v = verifyToken(runToken, ms)
        if (v !== 'ok') {
          res.statusCode = 403
          const msg = v === 'tooFast' ? 'Čas neodpovídá délce hry.'
            : v === 'expired' ? 'Platnost kola vypršela, zahraj znovu.'
            : 'Kolo nelze ověřit, zahraj znovu.'
          res.end(JSON.stringify({ error: msg }))
          return
        }
        const store = readStore()
        store.scores.push({ name, ms: Math.round(ms), date: todayPrague(), ts: Date.now() })
        writeStore(store)
        res.end(JSON.stringify(boardPayload(store)))
      } catch {
        res.statusCode = 400
        res.end(JSON.stringify({ error: 'Neplatný požadavek.' }))
      }
    })
    return
  }
  res.statusCode = 405
  res.end(JSON.stringify({ error: 'Method not allowed' }))
}

const scoresApiPlugin = {
  name: 'scores-api-local',
  configureServer(server) { server.middlewares.use(scoresMiddleware) },
  configurePreviewServer(server) { server.middlewares.use(scoresMiddleware) },
}

export default defineConfig({
  server: { host: true, port: 5180 },
  preview: { host: true, port: 5180 },
  build: { target: 'es2019' },
  plugins: [scoresApiPlugin],
})
