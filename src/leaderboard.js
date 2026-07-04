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

export async function submitScore(name, ms) {
  const r = await fetch('/api/scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, ms }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
  return data
}
