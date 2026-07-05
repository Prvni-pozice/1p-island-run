// leaderboard.js — klient žebříčku: GET/POST /api/scores + jméno hráče
// v localStorage. Server je lokální Vite middleware (VPS) nebo Vercel
// funkce — stejné relativní URL.
const NAME_KEY = '1p-island-run-name'

export function getSavedName() {
  return localStorage.getItem(NAME_KEY) || ''
}
export function saveName(name) {
  localStorage.setItem(NAME_KEY, name)
}

export async function fetchBoard() {
  const r = await fetch('/api/scores')
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

// Podepsaný token na začátku kola — server jím ověří platnost času.
export async function requestSession() {
  const r = await fetch('/api/scores?session=1')
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const d = await r.json()
  return d.token || null
}

// msRaw = hrubý odehraný čas; dinos = počet sebraných (bonus -10 s/kus).
// Net čas počítá server, aby anti-cheat dál vázal reálně strávený čas.
export async function submitScore(name, msRaw, dinos, token) {
  const r = await fetch('/api/scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, msRaw, dinos, token }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
  return data
}
