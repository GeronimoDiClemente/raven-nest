import { chromium } from '@playwright/test'
import fs from 'node:fs'

const URL = 'http://localhost:5199'
const REC_DIR = 'capture/rec'
fs.rmSync(REC_DIR, { recursive: true, force: true })
fs.mkdirSync(REC_DIR, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  recordVideo: { dir: REC_DIR, size: { width: 1920, height: 1080 } },
})

// auto-accept confirm() dialogs (Push to GitHub asks to open the compare URL)
const page = await ctx.newPage()
page.on('dialog', (d) => d.accept().catch(() => {}))
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))

// inject a visible cursor that follows real mouse events
await page.addInitScript(() => {
  const add = () => {
    if (document.getElementById('__cursor')) return
    const c = document.createElement('div')
    c.id = '__cursor'
    c.style.cssText = 'position:fixed;left:0;top:0;width:24px;height:24px;z-index:99999;pointer-events:none;filter:drop-shadow(0 2px 3px rgba(0,0,0,.6))'
    c.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M4 2 L4 20 L9 15 L12.5 22.5 L15.5 21 L12 13.5 L19 13.5 Z" fill="#fff" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/></svg>'
    document.body.appendChild(c)
    document.addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px' }, true)
  }
  if (document.body) add(); else window.addEventListener('DOMContentLoaded', add)
})

const sleep = (ms) => page.waitForTimeout(ms)
async function center(locator) {
  const b = await locator.boundingBox()
  if (!b) throw new Error('no bbox')
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}
let cur = { x: 960, y: 540 }
async function glide(locator, steps = 28) {
  const t = await center(locator)
  await page.mouse.move(t.x, t.y, { steps })
  cur = t
  await sleep(180)
  return t
}
async function click(locator) { const t = await glide(locator); await page.mouse.click(t.x, t.y); await sleep(350) }
async function rightClick(locator) { const t = await glide(locator); await page.mouse.click(t.x, t.y, { button: 'right' }); await sleep(350) }

await page.goto(URL, { waitUntil: 'load' })
await page.mouse.move(960, 540)
await page.waitForSelector('.wt-item', { timeout: 10000 })
await sleep(2200) // hero hold on the real app

async function createWorktree(name) {
  await click(page.locator('[data-tour-id="wt-add"]'))
  await page.waitForSelector('[data-tour-id="wt-branch-input"]', { timeout: 5000 })
  await sleep(400)
  const input = page.locator('[data-tour-id="wt-branch-input"]')
  await glide(input)
  await page.mouse.click(cur.x, cur.y)
  // type char-by-char so it reads like a person typing
  for (const ch of name) { await page.keyboard.type(ch); await sleep(55) }
  await sleep(500)
  await click(page.locator('[data-tour-id="wt-create-btn"]'))
  await sleep(1800) // running -> done
}

await createWorktree('feat/auth')
await createWorktree('fix/payments')
await sleep(900)

// open the diff for feat/dark-mode (the seed worktree with a real diff)
await click(page.locator('.wt-item', { hasText: 'feat/dark-mode' }).first())
await page.waitForTimeout(600)
await sleep(2600) // read the diff
await page.keyboard.press('Escape')
await sleep(700)

// right-click feat/dark-mode -> context menu -> Push to GitHub
await rightClick(page.locator('.wt-item', { hasText: 'feat/dark-mode' }).first())
await page.waitForSelector('.wt-context-menu', { timeout: 5000 })
await sleep(500)
await click(page.getByText('Push to GitHub', { exact: true }))
await sleep(2000)

await sleep(1200)
await page.close()
const video = page.video()
const out = video ? await video.path() : null
await ctx.close()
await browser.close()
console.log('VIDEO:', out)
