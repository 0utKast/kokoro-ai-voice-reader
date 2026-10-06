/**
 * Kokoro AI Voice Reader - Local PWA Development Server
 * 
 * Provides:
 * 1. Dual HTTP (3000) & HTTPS (3443) on all network interfaces (0.0.0.0).
 * 2. Cross-Origin-Opener-Policy & Cross-Origin-Embedder-Policy (COOP/COEP) for multi-threaded WASM.
 * 3. Secure Context for WebGPU execution on physical mobile devices.
 * 4. Service-Worker-Allowed: / header to enable root scope caching.
 * 5. Partial Range (HTTP 206) support for large binary assets (.wasm, .bin, .mp3).
 */

import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const HTTP_PORT = process.env.PORT || 8080;
const HTTPS_PORT = process.env.HTTPS_PORT || 8443;

// Detect all local network IPv4 addresses (Wi-Fi, Ethernet)
function getAllLocalIps() {
  const interfaces = os.networkInterfaces();
  const list = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        list.push({ name, address: iface.address });
      }
    }
  }
  return list;
}

const allIps = getAllLocalIps();
const primaryIp = allIps[0]?.address || '127.0.0.1';

// Ensure SSL Certificate exists or generate self-signed with all IP SANs
function getOrCreateSSLCert() {
  const sslDir = path.join(__dirname, 'ssl');
  const keyPath = path.join(sslDir, 'key.pem');
  const certPath = path.join(sslDir, 'cert.pem');

  const ipSans = allIps.map(ip => `IP:${ip.address}`).join(',');
  const sanList = `subjectAltName=${ipSans ? ipSans + ',' : ''}IP:127.0.0.1,DNS:localhost`;

  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    fs.mkdirSync(sslDir, { recursive: true });
    console.log('Generando certificado SSL autofirmado para desarrollo móvil...');
    try {
      execSync(
        `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -sha256 -days 365 -nodes ` +
        `-subj "/CN=${primaryIp}" -addext "${sanList}"`,
        { stdio: 'ignore' }
      );
    } catch (err) {
      console.warn('No se pudo generar certificado SSL automáticamente:', err.message);
      return null;
    }
  }

  try {
    return {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath)
    };
  } catch (err) {
    console.warn('Error leyendo certificados SSL:', err.message);
    return null;
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
  '.onnx': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

function handleRequest(req, res) {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(parsedUrl.pathname);

  // Telemetry endpoint for mobile debugging
  if (pathname === '/api/log' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        console.log(`📱 [Móvil]:`, parsed);
      } catch {
        console.log(`📱 [Móvil]:`, body);
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end('{"ok":true}');
    });
    return;
  }

  // Default redirect root to PWA
  if (pathname === '/' || pathname === '') {
    res.writeHead(302, { Location: '/pwa/' });
    res.end();
    return;
  }

  // If path ends with slash, default to index.html
  if (pathname.endsWith('/')) {
    pathname += 'index.html';
  }

  // Handle path aliases (e.g. if relative imports resolve to /src/src/libs or /pwa/src/)
  if (pathname.includes('/src/libs/')) {
    pathname = '/src/libs/' + pathname.split('/src/libs/').pop();
  } else if (pathname.includes('/src/voices/')) {
    pathname = '/src/voices/' + pathname.split('/src/voices/').pop();
  } else if (pathname.includes('/src/shared/')) {
    pathname = '/src/shared/' + pathname.split('/src/shared/').pop();
  }

  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(ROOT_DIR, safePath);

  // If directory requested without trailing slash, redirect with slash
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    res.writeHead(301, { Location: pathname + '/' });
    res.end();
    return;
  }

  if (!fs.existsSync(filePath)) {
    console.warn(`[404] No encontrado: ${pathname}`);
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`404 No encontrado: ${pathname}`);
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const stat = fs.statSync(filePath);
  const totalSize = stat.size;

  // Security and Cross-Origin Headers for WebGPU & SharedArrayBuffer (WASM SIMD multithreading)
  // Use credentialless to allow fetching cross-origin ONNX weights without strict CORP requirements
  const headers = {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'credentialless',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Service-Worker-Allowed': '/'
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, headers);
    res.end();
    return;
  }

  // Handle Range Requests (HTTP 206)
  const rangeHeader = req.headers.range;
  if (rangeHeader) {
    const parts = rangeHeader.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;

    if (start >= totalSize || end >= totalSize || start > end) {
      res.writeHead(416, {
        'Content-Range': `bytes */${totalSize}`,
        ...headers
      });
      res.end();
      return;
    }

    const chunkSize = end - start + 1;
    res.writeHead(206, {
      ...headers,
      'Content-Range': `bytes ${start}-${end}/${totalSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize
    });

    const stream = fs.createReadStream(filePath, { start, end });
    stream.pipe(res);
    return;
  }

  // Standard 200 response
  headers['Content-Length'] = totalSize;
  headers['Accept-Ranges'] = 'bytes';
  
  // Cache policy: short cache for code, long cache for immutable models/voices
  if (filePath.includes('/voices/') || ext === '.wasm' || ext === '.bin' || ext === '.onnx') {
    headers['Cache-Control'] = 'public, max-age=86400, immutable';
  } else {
    headers['Cache-Control'] = 'no-cache, must-revalidate';
  }

  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

// Start HTTP server
const httpServer = http.createServer(handleRequest);
httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
  // Try starting HTTPS server
  const sslOptions = getOrCreateSSLCert();
  if (sslOptions) {
    const httpsServer = https.createServer(sslOptions, handleRequest);
    httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
      printBanner(true);
    });
  } else {
    printBanner(false);
  }
});

function printBanner(hasHttps) {
  console.log('\n======================================================');
  console.log('   🚀 Servidor Kokoro AI PWA Móvil Activo');
  console.log('======================================================\n');
  console.log(`📱 [En este ordenador]:`);
  console.log(`   HTTP:   http://localhost:${HTTP_PORT}/pwa/`);
  if (hasHttps) {
    console.log(`   HTTPS:  https://localhost:${HTTPS_PORT}/pwa/`);
  }

  console.log(`\n📲 [En tu teléfono móvil (misma red local)]:`);
  allIps.forEach((iface) => {
    const label = iface.name.toLowerCase().includes('en1') ? 'Wi-Fi' : (iface.name.toLowerCase().includes('en0') ? 'Ethernet' : iface.name);
    console.log(`   📡 Conexión por ${label} (${iface.address}):`);
    if (hasHttps) {
      console.log(`      🌟 HTTPS: https://${iface.address}:${HTTPS_PORT}/pwa/`);
    }
    console.log(`      ⚡ HTTP:  http://${iface.address}:${HTTP_PORT}/pwa/`);
  });

  if (hasHttps) {
    console.log(`\n   ℹ️ Nota para HTTPS: Acepta el aviso de certificado en el navegador del móvil (Avanzado -> Continuar).`);
  }

  console.log(`\n🔌 [En Android con cable USB (Acceso directo a WebGPU)]:`);
  console.log(`   1. Conecta el teléfono por USB con Depuración USB activa`);
  console.log(`   2. Ejecuta: adb reverse tcp:${HTTP_PORT} tcp:${HTTP_PORT}`);
  console.log(`   3. Abre en Chrome Móvil: http://localhost:${HTTP_PORT}/pwa/`);
  console.log('======================================================\n');
}
