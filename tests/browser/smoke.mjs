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
// Sale con codigo 1 si falla cualquier check o si hay cualquier pageerror /
// console.error. Una suite de navegador que trague fallos es la enfermedad
// que este programa existe para curar.

import { withPage, withViewport, resolveBaseUrl } from './harness.mjs';

const results = [];

function failureLine(err) {
  const msg = String((err && err.message) || err);
  return msg.split('\n')[0];
}

async function check(name, fn, opts = {}) {
  const { expectedFailure = false, fullError = false } = opts;
  const errText = (err) => (fullError ? String((err && err.message) || err) : failureLine(err));
  try {
    await fn();
    if (expectedFailure) {
      results.push({ name, status: 'unexpected-pass', fullError });
      console.log(`[browser] ${name}: PASA INESPERADO — quitar la marca expectedFailure`);
    } else {
      results.push({ name, status: 'pass', fullError });
      console.log(`[browser] ${name}: pasa`);
    }
  } catch (err) {
    if (expectedFailure) {
      results.push({ name, status: 'expected-failure', error: err, fullError });
      console.log(`[browser] ${name}: fallo esperado (${errText(err)})`);
    } else {
      results.push({ name, status: 'fail', error: err, fullError });
      console.log(`[browser] ${name}: FALLA — ${errText(err)}`);
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

/**
 * Espera a que el cursor de reproducción real supere `minSeconds`, leyendo el
 * readout de tiempo (MM:SS.cc) en lugar de dormir un tiempo fijo: en una
 * máquina de CI cargada el audio avanza más lento y el sleep fijo es flaky.
 */
async function waitForCursor(page, minSeconds, timeout = 20000) {
  await page.waitForFunction(
    (min) => {
      const el = document.querySelector(
        'div[title="Rejilla (no estira el audio)"] > div:last-child',
      );
      const m = (el?.textContent ?? '').match(/(\d+):(\d{2})\.(\d{2})/);
      if (!m) return false;
      return Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 100 > min;
    },
    { timeout },
    minSeconds,
  );
}

async function main() {
  console.log(`[browser] base URL: ${resolveBaseUrl()}`);
  await withPage(async (page, shot, errors) => {
    await check('B1 arranque', async () => {
      try {
        await page.waitForSelector('[aria-label="Pantalla de inicio de HydraDAW"]', {
          visible: true,
          timeout: 30000,
        });
        if (errors.pageErrors.length > 0) {
          throw new Error(`pageerror en arranque: ${errors.pageErrors.join(' | ')}`);
        }
        await shot('b1-arranque');
      } catch (err) {
        await shot('b1-arranque-fallo');
        throw err;
      }
    });

    await check('B2 carga de la demo', async () => {
      try {
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
      } catch (err) {
        await shot('b2-demo-fallo');
        throw err;
      }
    });

    await check('B3 play/stop', async () => {
      try {
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
        await shot('b3-stop');
      } catch (err) {
        await shot('b3-fallo');
        throw err;
      }
    });

    await check('B4 split con S', async () => {
      try {
        const before = await clipCount(page);
        if (before !== 4) throw new Error(`precondición: clips=${before}, esperados 4`);
        await page.click('button[title="Reproducir (Espacio)"]');
        await page.waitForFunction(
          () => !!document.querySelector('button[title="Pausar (Espacio)"]'),
          { timeout: 15000 },
        );
        // Avanza el cursor hasta >1.5 s para que el corte caiga dentro del clip,
        // sondeando el readout real en vez de un sleep fijo (flaky en CI).
        // NOTA: este check parte EN REPRODUCCIÓN. Partir en pausa también
        // funciona: engine.stop() aparca playheadOffset y el store lo conserva
        // en pause (stop rebobina a 0 por convención DAW); B4b lo cubre.
        await waitForCursor(page, 1.5);
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
      } catch (err) {
        await shot('b4-fallo');
        throw err;
      }
    });

    await check('B4b split con S en pausa', async () => {
      const before = await clipCount(page);
      if (before !== 5) throw new Error(`precondición: clips=${before}, esperados 5`);
      await page.click('button[title="Reproducir (Espacio)"]');
      await page.waitForFunction(
        () => !!document.querySelector('button[title="Pausar (Espacio)"]'),
        { timeout: 15000 },
      );
      // Mismo sondeo del readout que B4: nada de sleeps fijos.
      await waitForCursor(page, 1.5);
      // Pausa: el cursor queda aparcado en posición no nula (stop aparca el
      // motor y pause conserva la posición en el store).
      await page.click('button[title="Pausar (Espacio)"]');
      await page.waitForFunction(
        () => !!document.querySelector('button[title="Reproducir (Espacio)"]'),
        { timeout: 15000 },
      );
      // Posición aparcada leída del readout real (MM:SS.cc), no de un sleep fijo.
      // Se lee el div del tiempo (último hijo), no todo el contenedor: los spans
      // de compás y tiempo van pegados en textContent y el regex mordería de más.
      const readout = await page.evaluate(
        () =>
          document.querySelector('div[title="Rejilla (no estira el audio)"] > div:last-child')
            ?.textContent ?? '',
      );
      const m = readout.match(/(\d+):(\d{2})\.(\d{2})/);
      if (!m) throw new Error(`readout ilegible: "${readout}"`);
      const paused = Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 100;
      if (!(paused > 0.5 && paused < 15)) {
        throw new Error(`pausa fuera del interior del clip: ${paused}`);
      }
      // Corta un clip largo intacto (el de B4 ya está partido en dos).
      await page.click('[aria-label="Clip Bass Progression"]');
      await page.keyboard.press('s');
      await page.waitForFunction(
        () => document.querySelectorAll('[role="option"]').length === 6,
        { timeout: 15000 },
      );
      // La frontera nueva está en el cursor aparcado, no en 0 (zoom 50 px/s).
      // Un corte en 0 se rechaza (mínimo 0.2 s), así que 5→6 ya prueba que es
      // interior; esto lo clava al cursor.
      const lefts = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[aria-label="Clip Bass Progression"]')).map((el) =>
          parseFloat(el.style.left),
        ),
      );
      if (lefts.length !== 2) throw new Error(`partes del bajo: ${lefts.length}, esperadas 2`);
      const expected = paused * 50;
      if (!lefts.some((l) => Math.abs(l - expected) < 8)) {
        throw new Error(
          `frontera ${JSON.stringify(lefts)} lejos del cursor ${paused} (esperado ~${expected.toFixed(1)}px)`,
        );
      }
      await page.click('button[title="Detener y volver al inicio (0:00)"]');
      await shot('b4b-split-pausa');
    });

    await check('B5 modal de export', async () => {
      await page.click('button[aria-label="Abrir diálogo de masterización y exportación"]');
      await page.waitForSelector('[aria-label="Exportar mezcla"]', {
        visible: true,
        timeout: 15000,
      });
      try {
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
      } finally {
        // El artefacto y el cierre ocurren siempre: un fallo aquí no debe
        // encadenarse con B6/B7 ni perder el pantallazo.
        await shot('b5-export');
        const open = await page.$('[aria-label="Exportar mezcla"]');
        if (open) {
          await page.click('button[aria-label="Cerrar diálogo de exportación"]');
          await page.waitForFunction(() => !document.querySelector('[aria-label="Exportar mezcla"]'), {
            timeout: 15000,
          });
        }
      }
    });

    await check('B6 layout 320px', async () => {
      await withViewport(page, 320, 640);
      await sleep(500);
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      await shot('b6-320px');
      if (scrollWidth > 320) {
        throw new Error(`scroll horizontal: scrollWidth=${scrollWidth} > 320`);
      }
      // UI-09: objetivos táctiles >= 44x44 (clases min-44 verificadas en DOM;
      // aquí el rectángulo real renderizado).
      const small = await page.evaluate(() => {
        const need = [
          'button[aria-label="Alejar zoom"]',
          'button[aria-label="Acercar zoom"]',
          'button[aria-label="Detener"]',
          'button[aria-label="Reproducir"]',
          'button[aria-label="Grabar"]',
          'button[aria-label="Activar bucle"]',
          'button[aria-label="Metrónomo"]',
          'button[aria-label="Silenciar master"]',
          'button[aria-label="Cortar clip"]',
          'button[aria-label^="Silenciar pista"]',
          'button[aria-label$="en solo"]',
          'button[aria-label^="Armar pista"]',
          'button[aria-label^="Eliminar pista"]',
        ];
        const bad = [];
        for (const sel of need) {
          const el = document.querySelector(sel);
          if (!el) {
            bad.push(`${sel}: no encontrado`);
            continue;
          }
          const r = el.getBoundingClientRect();
          if (!(r.width >= 44 && r.height >= 44)) {
            bad.push(`${sel}: ${Math.round(r.width)}x${Math.round(r.height)}`);
          }
        }
        // Metrónomo y VU master visibles en todos los breakpoints.
        const metro = document.querySelector('button[aria-label="Metrónomo"]');
        if (!metro || getComputedStyle(metro).display === 'none') bad.push('metrónomo oculto');
        const vu = document.querySelector('[title="Medidor de pico Master (0 dBFS)"]');
        if (!vu || getComputedStyle(vu).display === 'none') bad.push('VU master oculto');
        return bad;
      });
      if (small.length > 0) {
        throw new Error(`objetivos <44px: ${small.join(' | ')}`);
      }
      // Objetivos del mixer (vista mixer y vuelta a timeline para B7).
      await page.click('button[aria-label="Ver mixer"]');
      await page.waitForFunction(
        () => !!document.querySelector('button[aria-label="Añadir efecto"]'),
        { timeout: 15000 },
      );
      const mixerBad = await page.evaluate(() => {
        const need = [
          'button[title="Silenciar"]',
          'button[title="Solo"]',
          'button[title="Armar para grabación"]',
          'button[aria-label="Añadir efecto"]',
        ];
        const bad = [];
        for (const sel of need) {
          const el = document.querySelector(sel);
          if (!el) {
            bad.push(`${sel}: no encontrado`);
            continue;
          }
          const r = el.getBoundingClientRect();
          if (!(r.width >= 44 && r.height >= 44)) {
            bad.push(`${sel}: ${Math.round(r.width)}x${Math.round(r.height)}`);
          }
        }
        return bad;
      });
      await page.click('button[aria-label="Ver timeline"]');
      await page.waitForFunction(() => !!document.querySelector('[role="option"]'), {
        timeout: 15000,
      });
      if (mixerBad.length > 0) {
        throw new Error(`objetivos mixer <44px: ${mixerBad.join(' | ')}`);
      }
      await withViewport(page, 1440, 900);
      await sleep(300);
    });

    await check('B7 touch-action none', async () => {
      const touchAction = await page.evaluate(() => {
        const clip = document.querySelector('[role="option"]');
        if (!clip) throw new Error('no hay clips');
        return getComputedStyle(clip).touchAction;
      });
      await shot('b7-touch-action');
      if (touchAction !== 'none') {
        throw new Error(`touch-action computado: "${touchAction}", esperado "none"`);
      }
    });

    await check(
      'B8 cero errores de consola',
      async () => {
        await shot('b8-final');
        const problems = [
          ...errors.pageErrors.map((e) => `pageerror: ${e}`),
          ...errors.consoleErrors.map((e) => `console.error: ${e}`),
        ];
        if (problems.length > 0) {
          throw new Error(`${problems.length} error(es):\n${problems.join('\n')}`);
        }
      },
      { fullError: true },
    );

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
        const text = f.fullError ? String((f.error && f.error.message) || f.error) : failureLine(f.error);
        console.log(`[browser] fallo: ${f.name} — ${text}`);
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
