C++ Static Server for COOP/COEP (WASM Pthreads)

This tiny Windows C++ server serves your built web app with the required headers to enable cross-origin isolation, allowing WebAssembly pthreads (SharedArrayBuffer) to work in the browser.

What it does
- Serves static files from a directory (default: `manual_test_env/web`).
- Adds headers on every response:
  - Cross-Origin-Opener-Policy: same-origin
  - Cross-Origin-Embedder-Policy: require-corp
  - Cross-Origin-Resource-Policy: same-origin
- Supports GET and HEAD. Thread-per-connection concurrency.
- Guesses content types (includes `application/wasm` for .wasm).

Build
- With MSVC (recommended). Run from VS Developer PowerShell or any shell where `cl` is available:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-server.ps1
```

- With MinGW (fallback) if `g++` is available:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-server.ps1
```

Run
- Default port 8080 and default root `manual_test_env/web`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-server.ps1
```

- Custom port/root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-server.ps1 -Port 8081 -Root "manual_test_env/web"
```

- Or run the binary directly:

```powershell
server\bin\chess_server.exe 8080 manual_test_env/web
```

Notes
- The `require-corp` policy requires subresources to be same-origin or to opt-in via CORP. This server sends `Cross-Origin-Resource-Policy: same-origin` globally, which works for your local same-origin `.js`/`.wasm` files.
- Use the pthreads WASM build in the browser once this server is running. Your loader already falls back if cross-origin isolation isn’t available.
