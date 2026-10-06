/**
 * Test suite to verify PWA server functionality, MIME types, and security headers.
 */

import http from 'http';
import https from 'https';
import { spawn } from 'child_process';
import assert from 'assert';

const agent = new https.Agent({ rejectUnauthorized: false });

console.log('🧪 Iniciando verificación del Servidor PWA...');

const serverProc = spawn('node', ['scripts/pwa-server.js'], {
  cwd: process.cwd(),
  stdio: 'pipe'
});

serverProc.stdout.on('data', (d) => {
  // console.log('[Server stdout]:', d.toString());
});

// Wait for server to bind
await new Promise(r => setTimeout(r, 1200));

async function fetchHttp(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:8080${urlPath}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
}

async function fetchHttps(urlPath) {
  return new Promise((resolve, reject) => {
    https.get(`https://127.0.0.1:8443${urlPath}`, { agent }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
}

try {
  // 1. Root redirect
  const rootRes = await fetchHttp('/');
  assert.strictEqual(rootRes.status, 302, 'Root should redirect to /pwa/');
  assert.strictEqual(rootRes.headers.location, '/pwa/');
  console.log('  ✓ Redirección raíz / -> /pwa/ correcta');

  // 2. HTTP /pwa/index.html
  const pwaRes = await fetchHttp('/pwa/');
  assert.strictEqual(pwaRes.status, 200, 'HTTP /pwa/ should return 200');
  assert.ok(pwaRes.body.includes('Kokoro AI Voice Reader'), 'PWA HTML content matches');
  assert.strictEqual(pwaRes.headers['cross-origin-opener-policy'], 'same-origin', 'COOP header present');
  assert.strictEqual(pwaRes.headers['cross-origin-embedder-policy'], 'require-corp', 'COEP header present');
  assert.strictEqual(pwaRes.headers['service-worker-allowed'], '/', 'Service-Worker-Allowed header present');
  console.log('  ✓ Headers de seguridad COOP/COEP y Service-Worker-Allowed verificados');

  // 3. Manifest
  const manifestRes = await fetchHttp('/pwa/manifest.webmanifest');
  assert.strictEqual(manifestRes.status, 200);
  assert.ok(manifestRes.headers['content-type'].includes('manifest+json'));
  console.log('  ✓ Manifest servido con MIME correcto (application/manifest+json)');

  // 4. Shared code access (/src/libs/kokoro.web.js)
  const libRes = await fetchHttp('/src/libs/kokoro.web.js');
  assert.strictEqual(libRes.status, 200);
  assert.ok(libRes.headers['content-type'].includes('javascript'));
  console.log('  ✓ Código compartido /src/libs/ accesible desde el servidor PWA');

  // 5. Binary voices (/src/voices/ef_dora.bin)
  const voiceRes = await fetchHttp('/src/voices/ef_dora.bin');
  assert.strictEqual(voiceRes.status, 200);
  assert.ok(voiceRes.headers['content-length'] > 100000);
  console.log('  ✓ Voces neuronales binarias (/src/voices/) servidas correctamente');

  // 6. HTTPS endpoint
  const httpsRes = await fetchHttps('/pwa/');
  assert.strictEqual(httpsRes.status, 200, 'HTTPS endpoint returns 200');
  assert.ok(httpsRes.body.includes('Kokoro AI Voice Reader'));
  console.log('  ✓ HTTPS (puerto 8443) funcionando con certificado SSL autofirmado');

  console.log('\n🎉 ¡TODAS LAS PRUEBAS DEL SERVIDOR PWA PASARON CON ÉXITO!\n');
} finally {
  serverProc.kill();
}
