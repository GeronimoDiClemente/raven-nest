import { chromium } from '@playwright/test'

const URL = 'http://localhost:5199'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
page.on('console', (m) => console.log('PAGE:', m.type(), m.text()))
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
await page.goto(URL, { waitUntil: 'load' })
await page.waitForTimeout(2500)
await page.screenshot({ path: 'capture/boot.png' })
console.log('OK shot taken')
await browser.close()
