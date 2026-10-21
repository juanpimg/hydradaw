// tests/browser/serveDist.mjs
// Servidor estático mínimo para la fase de producción: sirve `dist/` aplicando
// el `public/_headers` REAL (formato Cloudflare Pages).
//
// El parseo respeta la indentación: una línea de regla empieza en la columna 0
// (ruta); una línea de cabecera va indentada (espacio/tab) y contiene ':'.
// NO se hace trim antes de clasificar: hacerlo aplicaría CERO cabeceras en
// silencio y la comprobación dejaría de medir nada.
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';

export function parseHeadersFile(text) {
  const rules = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (/^[ \t]/.test(line)) {
      // Línea de cabecera (indentada). Sin regla abierta se ignora.
      if (!current) continue;
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      current.headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    } else {
      // Línea de regla (columna 0): ruta Cloudflare (`/*`, `/assets/*`, exacta).
      current = { path: line.trim(), headers: {} };
      rules.push(current);
    }
  }
  return rules;
}

/**
 * Cabeceras efectivas para un pathname: primero las wildcard que encajan y
 * encima las de coincidencia exacta (la ruta específica gana por cabecera).
 */
export function headersFor(rules, pathname) {
  const out = {};
  for (const rule of rules) {
    if (rule.path === '/*') {
      Object.assign(out, rule.headers);
    } else if (rule.path.endsWith('*') && pathname.startsWith(rule.path.slice(0, -1))) {
      Object.assign(out, rule.headers);
    }
  }
  for (const rule of rules) {
    if (rule.path === pathname) Object.assign(out, rule.headers);
  }
  return out;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
};

/**
 * Crea el servidor. `onRequest(pathname)` observa cada petición (para
 * detectar exfiltración: el log lo posee el llamante).
 */
export function createDistServer({ distDir, headersPath, onRequest }) {
  const rules = parseHeadersFile(readFileSync(headersPath, 'utf8'));
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = normalize(url.pathname);
    try {
      onRequest?.(pathname + url.search);
    } catch {
      // El observador nunca debe tumbar una respuesta.
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('method not allowed');
      return;
    }
    let rel = pathname === '/' ? '/index.html' : pathname;
    // Evita escapes del directorio (defensa mínima del propio arnés).
    const file = join(distDir, rel);
    if (!file.startsWith(distDir) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    const headers = headersFor(rules, pathname);
    headers['Content-Type'] = MIME[extname(file)] ?? 'application/octet-stream';
    headers['Content-Length'] = String(statSync(file).size);
    res.writeHead(200, headers);
    if (req.method === 'GET') {
      res.end(readFileSync(file));
    } else {
      res.end();
    }
  });
  return { server, rules };
}
