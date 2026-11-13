// El comando que el pane del centinela escribe en su shell para correr la TUI con el Electron
// de Nest en modo Node. `ELECTRON_RUN_AS_NODE` queda sólo para ese comando: el shell del pane
// sigue sin la variable, así que un `code` lanzado después desde ahí no arranca en modo Node.
import { describe, it, expect } from 'vitest'
import { comandoDeLaTui, familiaDeShell } from '../comando-de-la-tui'

// Espacios y una comilla doble: lo que rompe un comando mal citado.
const EXEC = '/Applications/My "Nest".app/Contents/MacOS/Nest'
const SCRIPT = '/Applications/My "Nest".app/Contents/Resources/app.asar/dist-electron/memory-tui.js'
const EXEC_WIN = 'C:\\Program Files\\My "Nest"\\Nest.exe'
const SCRIPT_WIN = 'C:\\Program Files\\My "Nest"\\resources\\app.asar\\dist-electron\\memory-tui.js'

describe('comandoDeLaTui', () => {
  it('posix: la variable delante del comando, escapada con barra', () => {
    expect(comandoDeLaTui(EXEC, SCRIPT, 'posix')).toBe(
      'ELECTRON_RUN_AS_NODE=1 "/Applications/My \\"Nest\\".app/Contents/MacOS/Nest" '
      + '"/Applications/My \\"Nest\\".app/Contents/Resources/app.asar/dist-electron/memory-tui.js"',
    )
  })

  it('powershell: Start-Process que espera, literales simples y el script entre comillas dobles', () => {
    expect(comandoDeLaTui(EXEC_WIN, SCRIPT_WIN, 'powershell')).toBe(
      `$env:ELECTRON_RUN_AS_NODE='1'; try { Start-Process -NoNewWindow -Wait `
      + `-FilePath 'C:\\Program Files\\My "Nest"\\Nest.exe' `
      + `-ArgumentList '"C:\\Program Files\\My \\"Nest\\"\\resources\\app.asar\\dist-electron\\memory-tui.js"' } `
      + 'finally { Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue }',
    )
  })

  it('powershell: `$`, backtick y comilla simple no se interpolan ni cortan el literal', () => {
    expect(comandoDeLaTui("C:\\$env:X`n\\O'Neil\\Nest.exe", "C:\\$HOME`t\\O'Neil\\memory-tui.js", 'powershell')).toBe(
      `$env:ELECTRON_RUN_AS_NODE='1'; try { Start-Process -NoNewWindow -Wait `
      + `-FilePath 'C:\\$env:X\`n\\O''Neil\\Nest.exe' `
      + `-ArgumentList '"C:\\$HOME\`t\\O''Neil\\memory-tui.js"' } `
      + 'finally { Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue }',
    )
  })

  it('cmd: start /b /wait, y set vacío después pase lo que pase', () => {
    expect(comandoDeLaTui(EXEC_WIN, SCRIPT_WIN, 'cmd')).toBe(
      'set "ELECTRON_RUN_AS_NODE=1" && start "" /b /wait "C:\\Program Files\\My ""Nest""\\Nest.exe" '
      + '"C:\\Program Files\\My ""Nest""\\resources\\app.asar\\dist-electron\\memory-tui.js" '
      + '& set "ELECTRON_RUN_AS_NODE="',
    )
  })
})

describe('familiaDeShell', () => {
  it('pwsh y powershell, con o sin .exe y en cualquier caja, son powershell', () => {
    expect(familiaDeShell('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBe('powershell')
    expect(familiaDeShell('powershell.exe')).toBe('powershell')
    expect(familiaDeShell('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\PowerShell.EXE')).toBe('powershell')
    expect(familiaDeShell('/usr/local/bin/pwsh')).toBe('powershell')
  })

  it('cmd es cmd', () => {
    expect(familiaDeShell('C:\\Windows\\System32\\cmd.exe')).toBe('cmd')
    expect(familiaDeShell('cmd')).toBe('cmd')
  })

  it('el resto es posix', () => {
    expect(familiaDeShell('/bin/zsh')).toBe('posix')
    expect(familiaDeShell('/bin/bash')).toBe('posix')
    expect(familiaDeShell('C:\\Program Files\\Git\\bin\\bash.exe')).toBe('posix')
  })
})
