#!/usr/bin/env node
// tests/browser/prodCheck.mjs
// Fase de producción de test:browser: build + servir dist/ con las cabeceras
// REALES de public/_headers + Chrome real. Cubre lo que la suite contra el dev
// server NO PUEDE ver (el dev server no aplica ninguna cabecera): el sandbox
// bajo su CSP propia y la configuración de cabeceras de producción.
//
//   node tests/browser/prodCheck.mjs   (SKIP_BUILD=1 para reutilizar dist/)
//
// Sale con código 1 si falla cualquier check. El log de peticiones del
// servidor es la prueba de no-exfiltración: ningún payload malicioso puede
// haber llamado a la red sin dejar rastro en él.

import { execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { launchBrowser, collectErrors } from './harness.mjs';
import { createDistServer } from './serveDist.mjs';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const HEADERS = path.join(ROOT, 'public', '_headers');

const results = [];

function failureLine(err) {
  return String((err && err.message) || err).split('\n')[0];
}

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, status: 'pass' });
    console.log(`[prod] ${name}: pasa`);
  } catch (err) {
    results.push({ name, status: 'fail', error: err });
    console.log(`[prod] ${name}: FALLA — ${failureLine(err)}`);
  }
}

/** Clic sobre el primer <button> cuyo texto incluya alguno dado. */
async function clickButtonByText(page, ...texts) {
  const handle = await page.evaluateHandle((wanted) => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.find((b) => wanted.some((t) => (b.textContent ?? '').includes(t))) ?? null;
  }, texts);
  try {
    const el = handle.asElement();
    if (!el) throw new Error(`botón no encontrado: ${texts.join(' / ')}`);
    await el.click();
  } finally {
    await handle.dispose();
  }
}

/** Abre el editor si está cerrado (tras un import OK se cierra solo). */
async function ensureEditorOpen(page) {
  const has = await page.evaluate(() => !!document.querySelector('textarea'));
  if (!has) await clickButtonByText(page, 'Editor de Código VST');
  await page.waitForSelector('textarea', { visible: true, timeout: 15000 });
}
/** Rellena el textarea del editor de plugins (truco del setter nativo + input). */
async function fillEditor(page, code) {
  await page.waitForSelector('textarea', { visible: true, timeout: 15000 });
  await page.evaluate((text) => {
    const ta = document.querySelector('textarea');
    if (!ta) throw new Error('sin textarea');
    ta.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, text);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    if (ta.value !== text) throw new Error('el textarea no tomó el código');
  }, code);
}

async function compileAndWaitToast(page, fragment, timeout) {
  await clickButtonByText(page, 'Compilar e Insertar');
  await page.waitForFunction(
    (frag) => (document.querySelector('[role="status"]')?.textContent ?? '').includes(frag),
    { timeout },
    fragment
  );
}

const BENIGN_CODE = `const customPlugin = {
  id: 'prod_probe_gain',
  name: 'Prod Probe',
  category: 'utility',
  description: 'sonda de producción',
  parameters: [],
  createDSPNode: (ctx) => {
    const g = ctx.createGain();
    return { inputNode: g, outputNode: g, updateParameter: () => {} };
  }
};`;

const VALID_TAIL = `const customPlugin = {
  id: 'prod_evil',
  name: 'Cola válida',
  category: 'utility',
  description: 'definición válida tras el payload',
  parameters: [],
  createDSPNode: (ctx) => {
    const g = ctx.createGain();
    return { inputNode: g, outputNode: g, updateParameter: () => {} };
  }
};`;

const EVIL_PAYLOADS = [
  { name: 'globalThis.fetch', code: `globalThis.fetch('/__exfil_fetch__?d=1');\n${VALID_TAIL}`, sentinel: '/__exfil_fetch__' },
  { name: 'navigator.sendBeacon', code: `navigator.sendBeacon('/__exfil_beacon__', 'd');\n${VALID_TAIL}`, sentinel: '/__exfil_beacon__' },
  { name: 'alias de eval', code: `const e = eval;\ne("fetch('/__exfil_eval__')");\n${VALID_TAIL}`, sentinel: '/__exfil_eval__' },
  { name: 'window.__prodProbe', code: `window.__prodProbe.push('ejecutado');\n${VALID_TAIL}`, sentinel: null },
];

async function main() {
  if (process.env.SKIP_BUILD !== '1') {
    console.log('[prod] build de dist/…');
    execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
  }
  if (!existsSync(path.join(DIST, 'index.html'))) {
    throw new Error('sin dist/index.html (el build no generó nada)');
  }

  const requested = [];
  const { server } = createDistServer({
    distDir: DIST,
    headersPath: HEADERS,
    onRequest: (logged) => requested.push(logged),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/`;
  console.log(`[prod] sirviendo dist/ en ${base} con las cabeceras reales`);

  try {
    // ---- Fase 1: cabeceras sobre las respuestas ----
    await check('P1 CSP del documento sin unsafe-eval + COOP/COEP/HSTS/XFO/RP', async () => {
      const res = await fetch(base);
      if (!res.ok) throw new Error(`GET / → ${res.status}`);
      const csp = res.headers.get('content-security-policy') ?? '';
      if (!csp.includes("script-src 'self'")) throw new Error(`CSP sin script-src 'self': ${csp}`);
      if (csp.includes("'unsafe-eval'")) throw new Error(`CSP con unsafe-eval: ${csp}`);
      const need = {
        'cross-origin-opener-policy': 'same-origin',
        'cross-origin-embedder-policy': 'credentialless',
        'strict-transport-security': 'max-age',
        'x-frame-options': 'DENY',
        'referrer-policy': 'no-referrer',
      };
      for (const [name, frag] of Object.entries(need)) {
        const value = res.headers.get(name) ?? '';
        if (!value.includes(frag)) throw new Error(`${name} ausente/débil: "${value}"`);
      }
    });

    const sandboxCsp = { value: '' };
    await check('P2 CSP del sandbox con unsafe-eval y sin red', async () => {
      for (const p of ['sandbox.html', 'sandbox.js']) {
        const res = await fetch(base + p);
        if (res.status !== 200) throw new Error(`GET /${p} → ${res.status} (¿falta el asset?)`);
        const csp = res.headers.get('content-security-policy') ?? '';
        if (!csp.includes("'unsafe-eval'")) throw new Error(`/${p} sin unsafe-eval: ${csp}`);
        if (!csp.includes("connect-src 'none'")) throw new Error(`/${p} sin connect-src 'none': ${csp}`);
        if (csp.includes("'unsafe-inline'")) throw new Error(`/${p} con unsafe-inline: ${csp}`);
        sandboxCsp.value = csp;
      }
      // Una sola CSP (si se fusionaran la del /* y la específica, el sandbox moriría).
      const raw = await (await fetch(base + 'sandbox.js')).headers.get('content-security-policy');
      if (raw !== sandboxCsp.value) throw new Error('CSP inconsistente entre sandbox.html y sandbox.js');
    });

    await check('P3 /assets/* con caché inmutable', async () => {
      const assets = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js'));
      if (assets.length === 0) throw new Error('sin assets en dist/');
      const res = await fetch(base + 'assets/' + assets[0]);
      if (!res.ok) throw new Error(`GET asset → ${res.status}`);
      const cc = res.headers.get('cache-control') ?? '';
      if (!cc.includes('public') || !cc.includes('max-age=31536000') || !cc.includes('immutable')) {
        throw new Error(`Cache-Control débil: "${cc}"`);
      }
    });

    // ---- Fase 2: sandbox de extremo a extremo en Chrome real ----
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 900 });
      const errors = collectErrors(page);
      await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });

      await check('P4 arranque del build de producción', async () => {
        await page.waitForSelector('[aria-label="Pantalla de inicio de HydraDAW"]', {
          visible: true,
          timeout: 30000,
        });
        await clickButtonByText(page, 'Empezar con la demo', 'Seguir editando');
        await page.waitForFunction(
          () => document.querySelectorAll('[role="option"]').length === 4,
          { timeout: 30000 }
        );
      });

      await check('P5 plugin benigno aceptado bajo la CSP real', async () => {
        await page.evaluate(() => {
          window.__prodProbe = [];
        });
        await page.click('button[aria-label="Ver mixer"]');
        await page.waitForFunction(
          () => !!document.querySelector('button[aria-label="Añadir efecto"]'),
          { timeout: 15000 }
        );
        const addButtons = await page.$$('button[aria-label="Añadir efecto"]');
        if (addButtons.length === 0) throw new Error('sin botón Añadir efecto');
        await addButtons[0].click();
        await page.waitForSelector('[role="dialog"]', { visible: true, timeout: 15000 });
        await ensureEditorOpen(page);
        await fillEditor(page, BENIGN_CODE);
        await compileAndWaitToast(page, 'importado', 30000);
      });

      for (const evil of EVIL_PAYLOADS) {
        await check(`P6 malicioso rechazado (${evil.name})`, async () => {
          await ensureEditorOpen(page);
          await fillEditor(page, evil.code);
          await compileAndWaitToast(page, 'bloqueado', 15000);
        });
      }

      await check('P7 nada malicioso se ejecutó ni llamó a la red', async () => {
        const probe = await page.evaluate(() => window.__prodProbe ?? null);
        if (!Array.isArray(probe) || probe.length !== 0) {
          throw new Error(`__prodProbe tocada: ${JSON.stringify(probe)}`);
        }
        const hits = requested.filter((r) =>
          r.includes('__exfil_fetch__') || r.includes('__exfil_beacon__') || r.includes('__exfil_eval__')
        );
        if (hits.length > 0) throw new Error(`peticiones de exfiltración: ${hits.join(', ')}`);
      });

      await check('P8 cero errores de consola/pageerror', async () => {
        const problems = [
          ...errors.pageErrors.map((e) => `pageerror: ${e}`),
          ...errors.consoleErrors.map((e) => `console.error: ${e}`),
        ];
        if (problems.length > 0) {
          throw new Error(`${problems.length} error(es):\n${problems.join('\n')}`);
        }
      });
    } finally {
      await browser.close();
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status !== 'pass');
  console.log(`[prod] ${passed}/${results.length} checks verdes${failed.length > 0 ? `, ${failed.length} FALLO(S)` : ''}`);
  if (failed.length > 0) {
    for (const f of failed) console.log(`[prod] fallo: ${f.name} — ${failureLine(f.error)}`);
    throw new Error(`${failed.length} check(s) de producción fallaron`);
  }
}

try {
  await main();
} catch (err) {
  console.error(`[prod] ${failureLine(err)}`);
  process.exit(1);
}
