# Minimal dependency-free static server for the Eggshell Mold Maker.
# Serves ./app on http://localhost:<port> using only Windows PowerShell (.NET).
# No Node, no install, no admin rights required.
$ErrorActionPreference = 'Stop'
$root = Join-Path $PSScriptRoot 'app'
if (-not (Test-Path $root)) { Write-Host "Missing 'app' folder next to serve.ps1"; pause; exit 1 }
$rootFull = [System.IO.Path]::GetFullPath($root)

# Find a free loopback port.
$listener = $null
$port = 0
for ($p = 8173; $p -lt 8193; $p++) {
  try {
    $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $p)
    $l.Start()
    $listener = $l; $port = $p; break
  } catch { }
}
if (-not $listener) { Write-Host 'Could not find a free port (8173-8192).'; pause; exit 1 }

$mime = @{
  '.html'='text/html; charset=utf-8'; '.js'='text/javascript'; '.mjs'='text/javascript'
  '.css'='text/css'; '.wasm'='application/wasm'; '.json'='application/json'
  '.webmanifest'='application/manifest+json'; '.svg'='image/svg+xml'; '.png'='image/png'
  '.ico'='image/x-icon'; '.stl'='model/stl'; '.map'='application/json'; '.txt'='text/plain'
}

# Use 127.0.0.1 (not 'localhost') so it can't resolve to IPv6 ::1 and miss the
# IPv4-only listener. 127.0.0.1 is still a secure context (service worker + file
# dialogs work).
$url = "http://127.0.0.1:$port/"
Write-Host ""
Write-Host "  Eggshell Mold Maker is running at  $url"
Write-Host "  Keep this window open while you use the app. Close it to stop."
Write-Host ""
Start-Process $url

while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $stream = $client.GetStream()
    $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII)
    $requestLine = $reader.ReadLine()
    if ([string]::IsNullOrEmpty($requestLine)) { $client.Close(); continue }
    while ($true) { $h = $reader.ReadLine(); if ([string]::IsNullOrEmpty($h)) { break } }

    $path = ($requestLine -split ' ')[1]
    if ($path -match '\?') { $path = $path.Substring(0, $path.IndexOf('?')) }
    $path = [System.Uri]::UnescapeDataString($path)
    if ($path -eq '/') { $path = '/index.html' }

    $rel = $path.TrimStart('/') -replace '/', '\'
    $full = [System.IO.Path]::GetFullPath((Join-Path $root $rel))

    if ($full.StartsWith($rootFull) -and (Test-Path $full -PathType Leaf)) {
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $ext = [System.IO.Path]::GetExtension($full).ToLower()
      $ct = $mime[$ext]; if (-not $ct) { $ct = 'application/octet-stream' }
      $header = "HTTP/1.1 200 OK`r`nContent-Type: $ct`r`nContent-Length: $($bytes.Length)`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
    } else {
      $bytes = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found')
      $header = "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain`r`nContent-Length: $($bytes.Length)`r`nConnection: close`r`n`r`n"
    }
    $hb = [System.Text.Encoding]::ASCII.GetBytes($header)
    $stream.Write($hb, 0, $hb.Length)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
  } catch { } finally { $client.Close() }
}
