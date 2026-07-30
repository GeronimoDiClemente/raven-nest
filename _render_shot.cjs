const { _electron } = require('playwright')
const path = require('path')
;(async () => {
  const html = process.argv[2]
  const out = process.argv[3]
  const app = await _electron.launch({
    executablePath: require('electron'),
    args: [path.join(__dirname, '_render_main.cjs'), html],
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded').catch(() => {})
  await page.waitForTimeout(1500)
  await page.screenshot({ path: out })
  await app.close().catch(() => {})
  console.log('shot ok:', out)
})().catch((e) => { console.error('ERR', e && e.stack); process.exit(1) })
