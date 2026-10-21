#!/usr/bin/env node
// tests/browser/smoke.mjs
// Humo con Chrome real: CSS computados, layout, canvas, audio y foco solo
// existen en un navegador de verdad (jsdom no los cubre).
//
// Uso:
//   npm run dev -- --port 5199 &
//   npm run test:browser                 # usa http://localhost:5175
//   node tests/browser/smoke.mjs http://localhost:5199
//   BASE_URL=http://localhost:5199 npm run test:browser
//
// Sale con codigo 1 si falla cualquier check (salvo el expectedFailure B7)
// o si hay cualquier pageerror / console.error. Una suite de navegador que
// trague fallos es la enfermedad que este programa existe para curar.

import { withPage, withViewport, resolveBaseUrl } from './harness.mjs';

const results = [];

function failureLine(err) {
  const msg = String((err && err.message) || err);
  return msg.split('\n')[0];
}

async function check(name, fn, opts = {}) {
  const { expectedFailure = false } = opts;
  try {
    await fn();
    if (expectedFailure) {
      results.push({ name, status: 'unexpected-pass' });
      console.log(`[browser] ${name}: PASA INESPERADO — quitar la marca expectedFailure`);
    } else {
      results.push({ name, status: 'pass' });
      console.log(`[browser] ${name}: pasa`);
    }
  } catch (err) {
    if (expectedFailure) {
      results.push({ name, status: 'expected-failure', error: err });
      console.log(`[browser] ${name}: fallo esperado (${failureLine(err)})`);
    } else {
      results.push({ name, status: 'fail', error: err });
      console.log(`[browser] ${name}: FALLA — ${failureLine(err)}`);
    }
  }
}

/** Clic con raton real sobre el primer <button> cuyo texto incluya alguno dado. */
async function clickButtonByText(page, ...texts) {
  const handle = await page.evaluateHandle((wanted) => {
    const btns = Array.from(document.querySelectorAll('button'));
    return (
      btns.find((b) => wanted.some((t) => (b.textContent ?? '').includes(t))) ?? null
    );
  }, texts);
  try {
    const el = handle.asElement();
    if (!el) throw new Error(`botón no encontrado: ${texts.join(' / ')}`);
    await el.click();
  } finally {
    await handle.dispose();
  }
}

async function clipCount(page) {
  return page.evaluate(() => document.querySelectorAll('[role="option"]').length);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`[browser] base URL: ${resolveBaseUrl()}`);
  await withPage(async (page, shot, errors) => {
    await check('B1 arranque', async () => {
      await page.waitForSelector('[aria-label="Pantalla de inicio de HydraDAW"]', {
        visible: true,
        timeout: 30000,
      });
      if (errors.pageErrors.length > 0) {
        throw new Error(`pageerror en arranque: ${errors.pageErrors.join(' | ')}`);
      }
      await shot('b1-arranque');
    });

    await check('B2 carga de la demo', async () => {
      await clickButtonByText(page, 'Empezar con la demo', 'Seguir editando');
      await page.waitForFunction(
        () => !document.querySelector('[aria-label="Pantalla de inicio de HydraDAW"]'),
        { timeout: 30000 },
      );
      await page.waitForFunction(
        () => document.querySelectorAll('[role="option"]').length === 4,
        { timeout: 30000 },
      );
      const bodyText = await page.evaluate(() => document.body.textContent ?? '');
      // textContent (no innerText): el CSS `uppercase` hace que innerText devuelva "PISTAS (4)".
      if (!bodyText.includes('Pistas (4)')) {
        throw new Error('no se ven 4 pistas (falta el texto "Pistas (4)")');
      }
      const n = await clipCount(page);
      if (n !== 4) throw new Error(`clips visibles: ${n}, esperados 4`);
      await shot('b2-demo');
    });

    await check('B3 play/stop', async () => {
      await page.click('button[title="Reproducir (Espacio)"]');
      await page.waitForFunction(
        () => !!document.querySelector('button[title="Pausar (Espacio)"]'),
        { timeout: 15000 },
      );
      await shot('b3-playing');
      await page.click('button[title="Detener y volver al inicio (0:00)"]');
      await page.waitForFunction(
        () => !!document.querySelector('button[title="Reproducir (Espacio)"]'),
        { timeout: 15000 },
      );
    });

    await check('B4 split con S', async () => {
      const before = await clipCount(page);
      if (before !== 4) throw new Error(`precondición: clips=${before}, esperados 4`);
      await page.click('button[title="Reproducir (Espacio)"]');
      await page.waitForFunction(
        () => !!document.querySelector('button[title="Pausar (Espacio)"]'),
        { timeout: 15000 },
      );
      // Avanza el cursor (~2 s) para que el corte caiga dentro del clip.
      // NOTA: la S se pulsa EN REPRODUCCIÓN porque el engine congela su
      // playhead interno al pausar (stop() no actualiza playheadOffset y
      // getCurrentTime() vuelve al inicio): partir en pausa es un no-op
      // silencioso. Bug de producto real, fuera del alcance de este WP
      // (infra de tests + CI); queda registrado para un WP posterior.
      await sleep(2000);
      const clips = await page.$$('[role="option"]');
      const first = clips[0];
      if (!first) throw new Error('no hay clips para seleccionar');
      await first.click();
      await page.keyboard.press('s');
      await page.waitForFunction(
        () => document.querySelectorAll('[role="option"]').length === 5,
        { timeout: 15000 },
      );
      await page.click('button[title="Detener y volver al inicio (0:00)"]');
      await shot('b4-split');
    });

    await check('B5 modal de export', async () => {
      await page.click('button[aria-label="Abrir diálogo de masterización y exportación"]');
      await page.waitForSelector('[aria-label="Exportar mezcla"]', {
        visible: true,
        timeout: 15000,
      });
      const verdict = await page.evaluate(() => {
        const dialog = document.querySelector('[aria-label="Exportar mezcla"]');
        if (!dialog) return { ok: false, reason: 'sin diálogo' };
        if (dialog.getAttribute('role') !== 'dialog') return { ok: false, reason: 'sin role=dialog' };
        // W3C ARIA: aria-modal="true" declara el fondo como inerte.
        if (dialog.getAttribute('aria-modal') !== 'true') {
          return { ok: false, reason: 'sin aria-modal=true (fondo no marcado como inerte)' };
        }
        const active = document.activeElement;
        if (!active || !dialog.contains(active)) {
          return { ok: false, reason: 'foco inicial fuera del diálogo' };
        }
        return { ok: true, reason: '' };
      });
      if (!verdict.ok) throw new Error(`fondo interactivo: ${verdict.reason}`);
      await shot('b5-export');
      await page.click('button[aria-label="Cerrar diálogo de exportación"]');
      await page.waitForFunction(() => !document.querySelector('[aria-label="Exportar mezcla"]'), {
        timeout: 15000,
      });
    });

    await check('B6 layout 320px', async () => {
      await withViewport(page, 320, 640);
      await sleep(500);
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      await shot('b6-320px');
      await withViewport(page, 1440, 900);
      await sleep(300);
      if (scrollWidth > 320) {
        throw new Error(`scroll horizontal: scrollWidth=${scrollWidth} > 320`);
      }
    });

    // TODO(Task 18 / Task 20, WP7): quitar la marca expectedFailure al implementar
    // pointer events + touch-action:none en los clips (WaveformCanvas). Hoy el
    // estilo computado es "auto" y el arrastre falla en tactil.
    await check(
      'B7 touch-action none',
      async () => {
        const touchAction = await page.evaluate(() => {
          const clip = document.querySelector('[role="option"]');
          if (!clip) throw new Error('no hay clips');
          return getComputedStyle(clip).touchAction;
        });
        await shot('b7-touch-action');
        if (touchAction !== 'none') {
          throw new Error(`touch-action computado: "${touchAction}", esperado "none"`);
        }
      },
      { expectedFailure: true },
    );

    await check('B8 cero errores de consola', async () => {
      await shot('b8-final');
      const problems = [
        ...errors.pageErrors.map((e) => `pageerror: ${e}`),
        ...errors.consoleErrors.map((e) => `console.error: ${e}`),
      ];
      if (problems.length > 0) {
        throw new Error(`${problems.length} error(es):\n${problems.join('\n')}`);
      }
    });

    const passed = results.filter((r) => r.status === 'pass').length;
    const expected = results.filter((r) => r.status === 'expected-failure').length;
    const failed = results.filter((r) => r.status === 'fail' || r.status === 'unexpected-pass');
    console.log(
      `[browser] ${passed}/${results.length} checks verdes` +
        (expected > 0 ? `, ${expected} fallo(s) esperado(s)` : '') +
        (failed.length > 0 ? `, ${failed.length} FALLO(S)` : ''),
    );
    if (failed.length > 0) {
      for (const f of failed) {
        console.log(`[browser] fallo: ${f.name} — ${failureLine(f.error)}`);
      }
      throw new Error(`${failed.length} check(s) de navegador fallaron`);
    }
  });
}

try {
  await main();
} catch (err) {
  console.error(`[browser] ${failureLine(err)}`);
  process.exit(1);
}
