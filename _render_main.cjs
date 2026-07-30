const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const argv = process.argv.slice(-2)
const htmlPath = argv[0], outPath = argv[1]
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1160, height: 770, show: false, frame: false, backgroundColor: '#050506',
  })
  win.setOpacity(0)
  await win.loadFile(htmlPath)
  win.showInactive()
  await new Promise((r) => setTimeout(r, 1600))
  try {
    const img = await win.webContents.capturePage()
    const png = img.toPNG()
    fs.writeFileSync(outPath, png)
    console.log('CAPTURED', outPath, png.length, 'bytes', JSON.stringify(img.getSize()))
  } catch (e) {
    console.error('CAP-ERR', e && e.stack)
  }
  win.destroy()
  app.quit()
})
