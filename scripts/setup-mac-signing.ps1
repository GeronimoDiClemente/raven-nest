# Carga los 5 GitHub Secrets necesarios para firmar y notarizar el build de macOS.
# Uso (Windows PowerShell 5.1 o PowerShell Core 7+):
#   .\scripts\setup-mac-signing.ps1
# Si falla por execution policy:
#   powershell -ExecutionPolicy Bypass -File scripts\setup-mac-signing.ps1
#
# Requisitos: gh CLI logueado (gh auth status), .p12 ya generado y exportado desde Keychain.

$ErrorActionPreference = 'Stop'

$repo = 'GeronimoDiClemente/raven-nest'
$appleId = 'matiaslabari@gmail.com'
$teamId = 'N6RR4W6FV4'

function ConvertFrom-SecureToPlain {
    param([System.Security.SecureString]$Secure)
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

Write-Host "==> Verificando gh CLI" -ForegroundColor Cyan
gh auth status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "gh no esta logueado. Corre: gh auth login" -ForegroundColor Red
    exit 1
}

Write-Host "==> Pidiendo inputs" -ForegroundColor Cyan

$p12PathRaw = Read-Host "Path absoluto al .p12 (arrastra el archivo aqui o pega el path)"
# Limpiar basura de copy-paste: caracteres no printable, comillas, @ inicial, espacios
$p12Path = ($p12PathRaw -replace '[^\x20-\x7E]', '').Trim().TrimStart('@').Trim('"').Trim("'").Trim()
if (-not (Test-Path $p12Path)) {
    Write-Host "No existe el archivo en: '$p12Path'" -ForegroundColor Red
    Write-Host "Input crudo recibido: '$p12PathRaw'" -ForegroundColor Yellow
    Write-Host "Sugerencia: arrastra el archivo .p12 desde el Explorer a la ventana de PowerShell" -ForegroundColor Yellow
    exit 1
}

$p12PasswordSecure = Read-Host "Password del .p12 (no se muestra)" -AsSecureString
$p12Password = ConvertFrom-SecureToPlain -Secure $p12PasswordSecure

$appPasswordSecure = Read-Host "App-Specific Password de Apple - xxxx-xxxx-xxxx-xxxx (no se muestra)" -AsSecureString
$appPassword = ConvertFrom-SecureToPlain -Secure $appPasswordSecure

Write-Host "==> Convirtiendo .p12 a base64" -ForegroundColor Cyan
$p12Base64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($p12Path))
Write-Host ("    {0} bytes -> {1} chars base64" -f (Get-Item $p12Path).Length, $p12Base64.Length)

Write-Host "==> Cargando 5 secrets en $repo" -ForegroundColor Cyan

# Usamos --body en vez de pipe porque PowerShell 5.1 reencodea stdin con la codificacion
# de consola y rompe el base64. --body pasa el valor como argumento via la convencion de
# argumentos nativos de Windows, que preserva ASCII intacto.

gh secret set MAC_CSC_LINK --body $p12Base64 --repo $repo
if ($LASTEXITCODE -ne 0) { Write-Host "    [fail] MAC_CSC_LINK" -ForegroundColor Red; exit 1 }
Write-Host "    [ok] MAC_CSC_LINK" -ForegroundColor Green

gh secret set MAC_CSC_KEY_PASSWORD --body $p12Password --repo $repo
if ($LASTEXITCODE -ne 0) { Write-Host "    [fail] MAC_CSC_KEY_PASSWORD" -ForegroundColor Red; exit 1 }
Write-Host "    [ok] MAC_CSC_KEY_PASSWORD" -ForegroundColor Green

gh secret set APPLE_ID --body $appleId --repo $repo
if ($LASTEXITCODE -ne 0) { Write-Host "    [fail] APPLE_ID" -ForegroundColor Red; exit 1 }
Write-Host "    [ok] APPLE_ID" -ForegroundColor Green

gh secret set APPLE_APP_SPECIFIC_PASSWORD --body $appPassword --repo $repo
if ($LASTEXITCODE -ne 0) { Write-Host "    [fail] APPLE_APP_SPECIFIC_PASSWORD" -ForegroundColor Red; exit 1 }
Write-Host "    [ok] APPLE_APP_SPECIFIC_PASSWORD" -ForegroundColor Green

gh secret set APPLE_TEAM_ID --body $teamId --repo $repo
if ($LASTEXITCODE -ne 0) { Write-Host "    [fail] APPLE_TEAM_ID" -ForegroundColor Red; exit 1 }
Write-Host "    [ok] APPLE_TEAM_ID" -ForegroundColor Green

Write-Host ""
Write-Host "==> Verificando secrets cargados" -ForegroundColor Cyan
gh secret list --repo $repo | Select-String -Pattern 'MAC_CSC|APPLE_'

Write-Host ""
Write-Host "==> Listo. Proximo paso (F):" -ForegroundColor Green
Write-Host "    Bumpea package.json a 1.1.2 y pushea a main, o disparalo manual con:"
Write-Host "    gh workflow run release.yml --repo $repo"
