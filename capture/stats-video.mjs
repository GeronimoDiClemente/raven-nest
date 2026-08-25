// Slow, step-by-step walkthrough of the REAL Nest app, driven with Playwright's
// Electron support against a COPY of the logged-in userData (real session
// untouched). Records a video with a visible cursor + step screenshots.
//
// The Hub overlay is opened by dispatching the keybind event straight at
// `window` (the app's shortcut listener), which is reliable regardless of xterm
// focus. Teams/Stats are skipped here: their Supabase auth-token lock is
// contended while the real Nest is open, so they need Nest closed for a clean run.
//
// Run:  node capture/stats-video.mjs
import { _electron as electron } from '@playwright/test'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const REPO = process.cwd()
const MAIN = path.join(REPO, 'dist-electron', 'main.js')
const OUT = path.join(REPO, 'capture', 'stats-rec')
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })
if (!fs.existsSync(MAIN)) throw new Error(`Not built: ${MAIN} — run: npm run build`)

const SRC_UD = path.join(process.env.APPDATA, 'nest')
const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'nest-video-ud-'))
fs.cpSync(SRC_UD, UD, { recursive: true })
for (const rel of ['Local Storage/leveldb/LOCK', 'Session Storage/LOCK', 'SingletonLock']) {
  try { fs.rmSync(path.join(UD, rel)) } catch {}
}

const env = { ...process.env }
delete env.RAVEN_E2E
delete env.ELECTRON_RUN_AS_NODE

const log = (...a) => console.log(...a)
let n = 0
const shot = async (page, name) => {
  const p = path.join(OUT, `${String(n++).padStart(2, '0')}-${name}.png`)
  try { await page.screenshot({ path: p }); log('shot', name) } catch (e) { log('shot FAIL', name, e.message) }
}

const app = await electron.launch({
  args: [MAIN, `--user-data-dir=${UD}`],
  env,
  recordVideo: { dir: OUT, size: { width: 1600, height: 1000 } },
  timeout: 60_000,
})
const page = await app.firstWindow()
page.on('pageerror', (e) => log('PAGEERROR:', e.message))
await page.waitForLoadState('domcontentloaded')
const sleep = (ms) => page.waitForTimeout(ms)

await page.evaluate(() => {
  if (document.getElementById('__cursor')) return
  const c = document.createElement('div')
  c.id = '__cursor'
  c.style.cssText = 'position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 2px 3px rgba(0,0,0,.6))'
  c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2 L4 20 L9 15 L12.5 22.5 L15.5 21 L12 13.5 L19 13.5 Z" fill="#fff" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/></svg>'
  document.body.appendChild(c)
  document.addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px' }, true)
})

let cur = { x: 800, y: 500 }
async function glideBox(b, steps = 30) {
  const t = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  await page.mouse.move(t.x, t.y, { steps }); cur = t; await sleep(250); return t
}
async function glide(sel, { steps = 30, timeout = 8000 } = {}) {
  const el = page.locator(sel).first()
  await el.waitFor({ state: 'visible', timeout })
  const b = await el.boundingBox(); if (!b) throw new Error('no bbox ' + sel)
  return glideBox(b, steps)
}
async function click(sel, opts) { const t = await glide(sel, opts); await page.mouse.click(t.x, t.y); await sleep(600) }
const section = async (name, fn) => { try { await fn() } catch (e) { log(`[skip ${name}]`, e.message.split('\n')[0]) } }
// Fire the Hub keybind straight at window (bypasses xterm focus).
const toggleHub = () => page.evaluate(() =>
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'O', code: 'KeyO', ctrlKey: true, shiftKey: true, bubbles: true })))

// ── 0. Boot ──────────────────────────────────────────────────────
try {
  await page.locator('.app').waitFor({ state: 'visible', timeout: 25_000 })
  log('OK: logged-in shell visible')
} catch {
  await shot(page, 'NOT-logged-in')
  await hardClose(); log('!! copied session logged out — close Nest and retry'); process.exit(2)
}
await page.mouse.move(cur.x, cur.y); await sleep(2500); await shot(page, 'boot')

// ── 1. Slow tour of a couple real workspaces ─────────────────────
await section('tour', async () => {
  const tabs = page.locator('.tab')
  const total = await tabs.count()
  for (const i of [Math.min(5, total - 1), Math.min(1, total - 1)]) {   // e.g. voxia, then sti-travel
    const b = await tabs.nth(i).boundingBox(); if (!b) continue
    await glideBox(b); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await sleep(1800)
  }
  await shot(page, 'workspace')
})

// ── 2. Open the Hub overlay (mirrors of every live terminal) ─────
await section('hub-overlay', async () => {
  await toggleHub()
  await page.locator('.hub-overlay').waitFor({ state: 'visible', timeout: 6000 })
  await sleep(500); await page.mouse.move(760, 480, { steps: 20 }); await sleep(2600)
  await shot(page, 'hub-overlay')
  // glide across a few Hub tiles
  const tiles = page.locator('.hub-overlay .hub-tile, .hub-overlay .hub-panel [class*="tile"]')
  const tc = Math.min(await tiles.count(), 3)
  for (let i = 0; i < tc; i++) { const b = await tiles.nth(i).boundingBox(); if (b) { await glideBox(b, 22); await sleep(700) } }
  await sleep(1500); await shot(page, 'hub-tiles')
  await toggleHub(); await sleep(1200)   // close
})

await shot(page, 'back')
await sleep(800)
await hardClose()
log('DONE →', OUT)

async function hardClose() {
  const vid = page.video()
  try { await page.close({ runBeforeUnload: false }) } catch {}   // finalizes the video
  const pid = app.process()?.pid
  if (pid) { try { execSync(`taskkill /T /F /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
  if (vid) { try { log('VIDEO:', await vid.path()) } catch {} }
  try { fs.rmSync(UD, { recursive: true, force: true }) } catch {}
}
