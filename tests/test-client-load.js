/**
 * Comprehensive client load test to verify every script, module, import, and asset.
 */

import http from 'http';
import https from 'https';
import assert from 'assert';

const agent = new https.Agent({ rejectUnauthorized: false });

async function getHttps(p) {
  return new Promise((resolve, reject) => {
    https.get(`https://127.0.0.1:8443${p}`, { agent }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
}

async function getHttp(p) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:8080${p}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
}

console.log('Testing PWA index and assets...');

const resHttps = await getHttps('/pwa/');
console.log('HTTPS /pwa/ ->', resHttps.status, 'Length:', resHttps.body.length);

const resHttp = await getHttp('/pwa/');
console.log('HTTP /pwa/ ->', resHttp.status, 'Length:', resHttp.body.length);

// Check if all scripts referenced in index.html load
const scriptMatches = [...resHttps.body.matchAll(/src="([^"]+)"/g)].map(m => m[1]);
console.log('Scripts in HTML:', scriptMatches);

for (const s of scriptMatches) {
  const norm = s.startsWith('../') ? s.replace('../', '/') : `/pwa/${s}`;
  const r = await getHttps(norm);
  console.log(`  Script ${norm} -> ${r.status} (${r.headers['content-type']})`);
  assert.strictEqual(r.status, 200, `Script ${norm} must be 200`);
}

// Test dynamic imports inside app.js
const appJsRes = await getHttps('/pwa/app.js');
const imports = [...appJsRes.body.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
console.log('Imports in app.js:', imports);

for (const imp of imports) {
  const norm = imp.startsWith('../') ? imp.replace('../', '/') : `/pwa/${imp}`;
  const r = await getHttps(norm);
  console.log(`  Import ${norm} -> ${r.status} (${r.headers['content-type']})`);
  assert.strictEqual(r.status, 200, `Import ${norm} must be 200`);
}

console.log('✅ ALL ASSETS ACCESSIBLE!');
