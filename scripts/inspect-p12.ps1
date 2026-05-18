# Inspecciona un .p12 usando .NET nativo (sin openssl)
# Verifica: cert + private key + tipo correcto para code signing Mac
#
# Uso: .\scripts\inspect-p12.ps1

param(
    [string]$P12Path = "C:\Users\gerod\Downloads\nest-mac-cert.p12"
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $P12Path)) {
    Write-Host "No existe el .p12 en: $P12Path" -ForegroundColor Red
    exit 1
}

$fileSize = (Get-Item $P12Path).Length
Write-Host "==> Archivo: $P12Path ($fileSize bytes)" -ForegroundColor Cyan

$securePassword = Read-Host "Password del .p12 (no se muestra)" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) | Out-Null

Write-Host ""
Write-Host "==> Decodificando .p12" -ForegroundColor Cyan

try {
    $bytes = [IO.File]::ReadAllBytes($P12Path)
    $collection = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2Collection
    $collection.Import($bytes, $plainPassword, 'DefaultKeySet')
} catch {
    Write-Host "ERROR al decodificar:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ""
    Write-Host "Causas comunes:" -ForegroundColor Yellow
    Write-Host "  - Password incorrecta"
    Write-Host "  - .p12 corrupto"
    Write-Host "  - Archivo no es un .p12 valido"
    exit 1
}

Write-Host "==> Total entries: $($collection.Count)" -ForegroundColor Cyan
Write-Host ""

$idx = 0
foreach ($cert in $collection) {
    $idx++
    Write-Host "=== Cert $idx ===" -ForegroundColor Green
    Write-Host "Subject:        $($cert.Subject)"
    Write-Host "Issuer:         $($cert.Issuer)"
    Write-Host "FriendlyName:   $($cert.FriendlyName)"
    Write-Host "Thumbprint:     $($cert.Thumbprint)"
    Write-Host "NotBefore:      $($cert.NotBefore)"
    Write-Host "NotAfter:       $($cert.NotAfter)"

    if ($cert.HasPrivateKey) {
        Write-Host "HasPrivateKey:  TRUE" -ForegroundColor Green
    } else {
        Write-Host "HasPrivateKey:  FALSE !!!" -ForegroundColor Red
    }

    # Key Usage extension
    $eku = $cert.Extensions | Where-Object { $_.Oid.FriendlyName -eq 'Enhanced Key Usage' }
    if ($eku) {
        $ekuParsed = New-Object System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension($eku, $false)
        $usages = $ekuParsed.EnhancedKeyUsages | ForEach-Object { "$($_.FriendlyName) ($($_.Value))" }
        Write-Host "ExtendedKeyUsage:"
        $usages | ForEach-Object { Write-Host "  - $_" }
    }
    Write-Host ""
}

Write-Host "==> Validaciones para code signing Mac" -ForegroundColor Cyan
Write-Host ""

$signCert = $collection | Where-Object { $_.Subject -match 'Developer ID Application' } | Select-Object -First 1

if (-not $signCert) {
    Write-Host "[FAIL] Ningun cert con 'Developer ID Application' en Subject" -ForegroundColor Red
    Write-Host "       El cert exportado puede ser de tipo incorrecto (Apple Development, Distribution, etc.)"
    Write-Host "       Hay que volver a developer.apple.com y crear un cert tipo 'Developer ID Application'"
    exit 1
} else {
    Write-Host "[ OK ] Cert 'Developer ID Application' encontrado" -ForegroundColor Green
}

if (-not $signCert.HasPrivateKey) {
    Write-Host "[FAIL] El cert NO tiene private key !!!" -ForegroundColor Red
    Write-Host "       Es la causa probable del hang en codesign."
    Write-Host "       Hay que re-exportar desde Keychain: seleccionar cert + key juntos (Cmd+click)"
    exit 1
} else {
    Write-Host "[ OK ] Tiene private key" -ForegroundColor Green
}

if ($signCert.NotAfter -lt (Get-Date)) {
    Write-Host "[FAIL] Cert EXPIRADO ($($signCert.NotAfter))" -ForegroundColor Red
    exit 1
} else {
    $daysLeft = ($signCert.NotAfter - (Get-Date)).Days
    Write-Host "[ OK ] Cert vigente ($daysLeft dias restantes)" -ForegroundColor Green
}

Write-Host ""
Write-Host "==> Thumbprint para verificar contra el log de CI:" -ForegroundColor Cyan
Write-Host "    $($signCert.Thumbprint)" -ForegroundColor White
Write-Host "    (En el log del CI vimos: E40F032CD5A88F7C3B0A96A05A85F5DA5E2BB7C5)" -ForegroundColor Gray
