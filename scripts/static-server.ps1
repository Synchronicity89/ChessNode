param(
    [int]$Port = 8080,
    [string]$Root = "web"
)

$ErrorActionPreference = 'Stop'

function Get-ContentType($path){
    $ext = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
    switch ($ext) {
        '.html' { 'text/html; charset=utf-8'; break }
        '.htm'  { 'text/html; charset=utf-8'; break }
        '.js'   { 'application/javascript; charset=utf-8'; break }
        '.mjs'  { 'application/javascript; charset=utf-8'; break }
        '.css'  { 'text/css; charset=utf-8'; break }
        '.json' { 'application/json; charset=utf-8'; break }
        '.wasm' { 'application/wasm'; break }
        '.ico'  { 'image/x-icon'; break }
        '.png'  { 'image/png'; break }
        '.jpg'  { 'image/jpeg'; break }
        '.jpeg' { 'image/jpeg'; break }
        '.gif'  { 'image/gif'; break }
        '.svg'  { 'image/svg+xml'; break }
        '.map'  { 'application/octet-stream'; break }
        '.txt'  { 'text/plain; charset=utf-8'; break }
        default { 'application/octet-stream' }
    }
}

function Combine-PathSafe([string]$root, [string]$rel){
    $fullRoot = [System.IO.Path]::GetFullPath($root)
    $candidate = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($fullRoot, $rel))
    if (-not $candidate.StartsWith($fullRoot, [System.StringComparison]::OrdinalIgnoreCase)){
        throw "Path traversal blocked"
    }
    return $candidate
}

if (-not (Test-Path $Root)) { throw "Root not found: $Root" }

$prefix = "http://127.0.0.1:$Port/"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
$listener.Start()
Write-Host "Static server listening at $prefix" -ForegroundColor Green
Write-Host "Serving root: $Root" -ForegroundColor Green

try {
    while ($listener.IsListening) {
        $ctx = $listener.GetContext()
        $req = $ctx.Request
        $res = $ctx.Response
        try {
            if ($req.HttpMethod -ne 'GET' -and $req.HttpMethod -ne 'HEAD'){
                $res.StatusCode = 405
                $res.Close()
                continue
            }

            $rawUrl = $req.RawUrl
            if (-not $rawUrl) { $rawUrl = '/' }
            $path = [uri]::UnescapeDataString($rawUrl.Split('?')[0])
            if ($path -eq '/' -or $path.EndsWith('/')) { $path = $path.TrimEnd('/') + '/index.html' }
            $path = $path.TrimStart('/')
            $fsPath = Combine-PathSafe -root $Root -rel $path

            if (-not (Test-Path $fsPath)){
                $res.StatusCode = 404
                $res.Close()
                continue
            }

            $ctype = Get-ContentType $fsPath
            $res.ContentType = $ctype
            $bytes = [System.IO.File]::ReadAllBytes($fsPath)
            if ($req.HttpMethod -eq 'GET'){
                $res.OutputStream.Write($bytes, 0, $bytes.Length)
            }
            $res.StatusCode = 200
            $res.Close()
        } catch {
            try { $res.StatusCode = 500; $res.Close() } catch {}
        }
    }
} finally {
    try { $listener.Stop(); $listener.Close() } catch {}
}
