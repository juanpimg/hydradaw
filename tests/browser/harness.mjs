// tests/browser/harness.mjs
// Arnes minimo para la capa de navegador real (Chrome via puppeteer-core).
// Sin dependencias nuevas: usa el Chrome del sistema (ver orden en
// resolveChromeExecutable) y el dev server de Vite.

import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_BASE_URL = 'http://localhost:5175';
export const DEFAULT_VIEWPORT = { width: 1440, height: 900 };

export const CHROME_FLAGS = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--autoplay-policy=no-user-gesture-required',
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
];

/**
 * Resuelve el ejecutable de Chrome por orden de preferencia.
 * Lanza (nunca salta en silencio) si no hay ninguno disponible.
 */
export function resolveChromeExecutable() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ].filter((p) => typeof p === 'string' && p.length > 0);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    'No se encontró Chrome. Instala google-chrome-stable o define PUPPETEER_EXECUTABLE_PATH.',
  );
}

export async function launchBrowser() {
  const executablePath = resolveChromeExecutable();
  return puppeteer.launch({ executablePath, headless: true, args: CHROME_FLAGS });
}

/**
 * Registra pageerror y console.error de la pagina.
 * Llamar ANTES de navegar para no perder errores de carga.
 */
export function collectErrors(page) {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (err) => {
    pageErrors.push(String((err && err.stack) || err));
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  return { pageErrors, consoleErrors };
}

export async function withViewport(page, width, height) {
  await page.setViewport({ width, height });
}

export function resolveBaseUrl(opts = {}) {
  return opts.baseUrl ?? process.argv[2] ?? process.env.BASE_URL ?? DEFAULT_BASE_URL;
}

/**
 * Abre el navegador, navega a la base URL y ejecuta fn(page, shot, errors).
 * - shot(name) guarda test-artifacts/browser/<name>.png y devuelve la ruta.
 * - errors es { pageErrors, consoleErrors } recogidos desde antes de navegar.
 * Cierra el navegador siempre (try/finally). Cualquier throw de fn propaga
 * al llamante (el script de humo convierte eso en exit 1).
 */
export async function withPage(fn, opts = {}) {
  const baseUrl = resolveBaseUrl(opts);
  const viewport = opts.viewport ?? DEFAULT_VIEWPORT;
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    const errors = collectErrors(page);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const shot = async (name) => {
      const dir = path.join(process.cwd(), 'test-artifacts', 'browser');
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, `${name}.png`);
      await page.screenshot({ path: file });
      return file;
    };
    await fn(page, shot, errors);
  } finally {
    await browser.close();
  }
}
