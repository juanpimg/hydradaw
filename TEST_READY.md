# HydraDAW — Test Suite Readiness (TEST_READY.md)

**Status**: HONESTO — contrato verde (172/172) · DOM verde (1/1) · navegador pendiente (Tarea 3)  
**Timestamp**: 2026-10-21T02:00:00Z  
**Track**: Hardening WP1 (T1+T2): arnés DOM + honestización de la suite

> La antigua etiqueta "READY — 100% Passing" era teatro: 16 de los tests afirmaban
> literales o variables locales del propio test y no podían fallar. Se eliminaron en T2
> (sus escenarios reales se re-implementan como tests DOM/browser en oleadas siguientes).
> La capa de navegador todavía no existe (se añade en la Tarea 3). El arnés DOM quedó
> verde tras fijar `jsdom@25.x` (ver §6).

---

## 1. Test Runner Commands

- **Run Full Project Test Suite** (29 test files, 439 tests: unit + contract + dom):
  ```bash
  npm test
  ```
- **Run contract 4-Tier Suite** (contrato opaco, sin DOM: 6 test files, 172 tests):
  ```bash
  npx vitest run src/tests/contract
  ```
- **Run DOM-layer tests** (jsdom + Testing Library, 1 test de humo del arnés):
  ```bash
  npm run test:dom
  ```
- **Run every layer** (unit + contract + dom + browser):
  ```bash
  npm run test:all
  ```
- **Run by Specific Tier** (capa de contrato):
  ```bash
  # Tier 1: Feature Coverage (29 + 40 tests)
  npx vitest run src/tests/contract/tier1_m1_m2_features.test.ts src/tests/contract/tier1_m3_m4_features.test.ts

  # Tier 2: Boundary & Corner Cases (85 tests)
  npx vitest run src/tests/contract/tier2_m1_m2_boundaries.test.ts src/tests/contract/tier2_m3_m4_boundaries.test.ts

  # Tier 3: Pairwise Combinations (12 tests)
  npx vitest run src/tests/contract/tier3_combinations.test.ts

  # Tier 4: Real-World Workflows (6 tests)
  npx vitest run src/tests/contract/tier4_scenarios.test.ts
  ```
- **Verify TypeScript Build**:
  ```bash
  npm run build
  ```

---

## 2. Test Tier Summary & Count Verification

| Test Tier | Focus & Methodology | Required Min | Actual Count | Pass Rate | Status |
|-----------|---------------------|--------------|--------------|-----------|--------|
| **Tier 1** | Feature Coverage (>=5 test cases per feature for F1–F17) | 85 | **69** (29 + 40; 16 tautológicos eliminados en T2) | 100% (69/69) | PASSED |
| **Tier 2** | Boundary & Corner Cases (>=5 test cases per feature for F1–F17) | 85 | **85** | 100% (85/85) | PASSED |
| **Tier 3** | Cross-Feature Combinations (Pairwise interactions across F1–F17) | 10 | **12** | 100% (12/12) | PASSED |
| **Tier 4** | Real-World Application Workflows (>=5 full user scenarios) | 5 | **6** | 100% (6/6) | PASSED |
| **Total contrato** | Contrato opaco sin DOM (antes "E2E") | **185** | **172** | **100% (172/172)** | **GREEN** |
| **Total proyecto** | Unit + Integration + Persistence + contrato + dom | — | **439** | **100% (439/439)** | **GREEN** |
| **Capa DOM** | jsdom + Testing Library (1 test de humo del arnés) | 1 | 1/1 | GREEN |
| **Capa navegador** | Chromium real vía puppeteer-core | — | 0 | No existe aún (Tarea 3) | **PENDING** |

> Tras T2, F5 y F8 no tienen cobertura nominal en Tier 1 (sus 5+5 tests eran literales);
> conservan cobertura de bordes en Tier 2 y recuperan la nominal como tests DOM reales
> (estilos computados y hitbox medida) en oleadas siguientes.

### Capas de test (qué cubre cada una y qué no)

| Capa | Qué cubre | Qué NO cubre | Estado |
|------|-----------|--------------|--------|
| **unit** | Lógica pura y store (timeline, waveforms, plugins, persistencia, atajos) | Sin DOM, sin audio real, sin navegador | Verde |
| **contract** | Contratos observables sin DOM: store, engine, oráculos, F1–F17 nominal + bordes | No monta componentes ni verifica CSS/eventos reales; no abre navegador | Verde (172/172) |
| **dom** | Componentes montados: roles/aria, estilos computados, eventos simulados | Sin layout real ni Web Audio real; sin navegador | Verde (1/1) |
| **browser** | Navegador real: layout, pointer/touch, regresión visual | — | No existe (Tarea 3) |

---

## 3. Feature Inventory & Coverage Checklist (F1–F17)

| Feature | Description | Milestone | Tier 1 (Nominal) | Tier 2 (Boundary) | Tier 3 (Pairwise) | Tier 4 (Workflow) | Overall |
|---------|-------------|-----------|------------------|-------------------|-------------------|-------------------|---------|
| **F1** | Resilient Audio Startup & Toast | M1 | 3 tests (2 tautológicos eliminados en T2) | 5 tests | C1 | Scenario 1, Scenario 3 | VERIFIED |
| **F2** | AudioEngine Context Fallback | M1 | 5 tests | 5 tests | C10 | Scenario 3 | VERIFIED |
| **F3** | Safe Demo & Blank Project Boot | M1 | 5 tests | 5 tests | C1 | Scenario 1, Scenario 2, Scenario 5 | VERIFIED |
| **F4** | Pointer Events for WaveformCanvas | M2 | 3 tests (2 tautológicos eliminados en T2) | 5 tests | C2, C9 | Scenario 1, Scenario 2 | VERIFIED |
| **F5** | Touch-Action None on Interactive Surfaces | M2 | 0 nominal (5 tautológicos eliminados; se re-implementan en DOM) | 5 tests | C2 | Scenario 1, Scenario 4 | NOMINAL PENDIENTE (DOM) |
| **F6** | Touch Ergonomic Trim Zones | M2 | 5 tests | 5 tests | C2, C3 | Scenario 1, Scenario 2, Scenario 6 | VERIFIED |
| **F7** | Rotary Control Pointer Capture | M2 | 4 tests (1 tautológico eliminado en T2) | 5 tests | C4 | Scenario 4 | VERIFIED |
| **F8** | Touch Hitbox Standards (>=44x44px) | M2 | 0 nominal (5 tautológicos eliminados; se re-implementan en DOM) | 5 tests | C4, C11 | Scenario 1, Scenario 2, Scenario 4 | NOMINAL PENDIENTE (DOM) |
| **F9** | UI Clip Deletion Action | M2 | 4 tests (1 tautológico eliminado en T2) | 5 tests | C3, C11 | Scenario 1, Scenario 6 | VERIFIED |
| **F10** | Timeline Bidirectional Scroll Sync | M3 | 5 tests | 5 tests | C5, C9 | Scenario 2 | VERIFIED |
| **F11** | Sticky Ruler & Alignment | M3 | 5 tests | 5 tests | C5 | Scenario 2, Scenario 5 | VERIFIED |
| **F12** | Ruler Horizontal Width Unification | M3 | 5 tests | 5 tests | C5, C6 | Scenario 2, Scenario 5 | VERIFIED |
| **F13** | Ruler Seek Clamping | M3 | 5 tests | 5 tests | C6, C12 | Scenario 2, Scenario 6 | VERIFIED |
| **F14** | Timeline 320px Usability & Adaptive Headers | M3 | 5 tests | 5 tests | C7 | Scenario 1, Scenario 6 | VERIFIED |
| **F15** | Responsive Floating Toolbar | M3 | 5 tests | 5 tests | C7, C11 | Scenario 2, Scenario 6 | VERIFIED |
| **F16** | Responsive Header Layout | M4 | 5 tests | 5 tests | C7, C8 | Scenario 3, Scenario 4, Scenario 5, Scenario 6 | VERIFIED |
| **F17** | Essential Transport Control Retention | M4 | 5 tests | 5 tests | C8, C10, C12 | Scenario 1, Scenario 4, Scenario 5 | VERIFIED |

---

## 4. Test Suite File Manifest

```
src/tests/contract/
├── helpers/
│   └── testHelpers.ts                 # Fábricas, resets de store (+resetHistory) y oráculos matemáticos
├── tier1_m1_m2_features.test.ts       # Tier 1: F1–F9 Feature Coverage (29 tests; 16 tautológicos eliminados en T2)
├── tier1_m3_m4_features.test.ts       # Tier 1: F10–F17 Feature Coverage (40 tests)
├── tier2_m1_m2_boundaries.test.ts     # Tier 2: F1–F9 Boundary & Corner Cases (45 tests)
├── tier2_m3_m4_boundaries.test.ts     # Tier 2: F10–F17 Boundary & Corner Cases (40 tests)
├── tier3_combinations.test.ts         # Tier 3: Pairwise Cross-Feature Interactions (12 tests)
└── tier4_scenarios.test.ts            # Tier 4: Real-World End-to-End Application Workflows (6 tests)
```

```
src/tests/dom/
├── setup.ts                           # Stubs de entorno (canvas, PointerEvent, AudioContext, matchMedia, …)
├── audioContextStub.ts                # MockAudioContext compartido con la capa de contrato
└── harness.test.tsx                   # Test de humo del arnés (verde)
```

---

## 5. Build and Execution Evidence

- **`npx vitest run src/tests/contract`**:
  ```
  Test Files  6 passed (6)
       Tests  172 passed (172)
  ```
- **`npm test`**:
  ```
  Test Files  29 passed (29)
       Tests  439 passed (439)
  ```
- **`npm run build`**:
  ```
  tsc && vite build
  ✓ built (0 errors, 0 warnings)
  ```
- **`npx tsc --noEmit`**: limpio.

---

## 6. Resolución toolchain de la capa DOM (jsdom 25.x)

El arnés DOM de T1 está implementado (`src/tests/dom/setup.ts`,
`src/tests/dom/audioContextStub.ts`, `src/tests/dom/harness.test.tsx`,
`test.setupFiles` + `environment: 'node'` en `vite.config.ts`, scripts
`test:dom`/`test:browser`/`test:all`), pero `jsdom@30.1.3` **no puede cargarse
en Node 20.18** (toolchain del proyecto, fijado por `.nvmrc` y Cloudflare Pages):

1. `html-encoding-sniffer` (CJS) hace `require()` de `@exodus/bytes` (ESM puro),
   `ERR_REQUIRE_ESM` (resuelto de forma nativa desde Node 20.19).
2. `undici@8` exige `zlib.createZstdDecompress` (inexistente en toda la serie 20.x).
3. `undici@8` exige `worker_threads.markAsUncloneable` (inexistente en 20.x).
4. `jsdom@30` usa el global `Iterator` (Iterator Helpers, V8 11.7+; inexistente en
   20.x e insustituible con un stub sin falsear la semántica del DOM).

`jsdom@30.1.3` declara `engines: node ^22.22.2 || ^24.15.0 || >=26` y su `undici`
`engines: node >=22.19.0`: la combinación jsdom 30 + Node 20 es imposible por
declaración del vendor y por los 4 fallos empíricos (ver reporte WP1).

**Resolución (controlador)**: `jsdom` fijado a la serie 25.x (`jsdom@25.0.1`,
`engines >=18`; cambio de una sola devDependency, toolchain intacto).
`npm run test:dom` → 1/1 verde; `npm test` → 29 ficheros, 439/439, exit 0.
Detalle completo en el reporte WP1.
