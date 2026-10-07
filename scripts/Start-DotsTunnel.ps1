param([switch]$SaveKeyOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$secretDir = Join-Path $projectRoot 'work\secrets'
$secretFile = Join-Path $secretDir 'dots-tunnel-key.dpapi'
$client = Join-Path $projectRoot 'work\tools\tunnel-client-v0.0.15\tunnel-client.exe'
$config = Join-Path $projectRoot 'work\tunnel-profiles\moru-personal.yaml'
if (-not (Test-Path -LiteralPath $client) -or -not (Test-Path -LiteralPath $config)) {
    throw 'Tunnel client or profile is missing. Follow DOTS-INTEGRATION.md.'
}
if ($SaveKeyOnly -or -not (Test-Path -LiteralPath $secretFile)) {
    $secureKey = Read-Host 'Paste the NEW moru-tunnel-runtime API key (input is hidden)' -AsSecureString
    $keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
    try {
        $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
        if ($plainKey -notmatch '^sk-[A-Za-z0-9_-]{20,}$') { throw 'Invalid API key format. Nothing was saved.' }
    } finally {
        $plainKey = $null
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
    }
    New-Item -ItemType Directory -Path $secretDir -Force | Out-Null
    # Without -Key, Windows uses DPAPI for the current Windows account.
    $encryptedKey = ConvertFrom-SecureString -SecureString $secureKey
    Set-Content -LiteralPath $secretFile -Value $encryptedKey -Encoding Ascii
    $secureKey.Dispose()
    $encryptedKey = $null
    Write-Host 'Saved encrypted runtime key for this Windows account. The key was not printed.'
    if ($SaveKeyOnly) { return }
}
$secureKey = (Get-Content -LiteralPath $secretFile -Raw).Trim() | ConvertTo-SecureString
$keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
$previousKey = $env:CONTROL_PLANE_API_KEY
try {
    # Only this process and the launched tunnel process receive the decrypted value.
    $env:CONTROL_PLANE_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
    Write-Host 'Starting the private Moru tunnel. Keep this window open; Ctrl+C stops it.'
    & $client run --config $config
    if ($LASTEXITCODE -ne 0) { throw 'Tunnel exited with an error. Review the redacted tunnel status.' }
} finally {
    $env:CONTROL_PLANE_API_KEY = $previousKey
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
    $secureKey.Dispose()
}

