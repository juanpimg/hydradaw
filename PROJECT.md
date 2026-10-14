# Project: HydraDAW

## Architecture
HydraDAW is a client-side digital audio workstation (DAW) built with React 18, TypeScript, Tailwind CSS, Zustand, and Web Audio API.
- **Presentation Layer (`src/components/`)**:
  - `Header/Header.tsx`: Brand, project name, view switcher, action buttons (New Track, Export).
  - `Timeline/`: Sequencer UI consisting of `Timeline.tsx`, `TrackHeader.tsx`, `WaveformCanvas.tsx`, and `Ruler.tsx`.
  - `Mixer/`: `MixerConsole.tsx`, `ChannelStrip.tsx`, `VUMeter.tsx`.
  - `Transport/TransportBar.tsx`: Transport controls (Play/Pause, Stop, Record, Loop), timeline displays, tempo, metronome, master peak meter, master volume.
  - `Plugins/`: `PluginRackModal.tsx`, `Knob.tsx`.
  - `Start/StartScreen.tsx`: Initial welcome screen modal.
  - `Toast/Toaster.tsx`: Toast notifications (`useDawStore.pushToast`).
- **State & Storage Layer (`src/store/`)**:
  - `useDawStore.ts`: Central Zustand store for tracks, clips, playback, modals, and toasts.
  - `persistence.ts`: IndexedDB storage via `idb-keyval` with auto-save and Float32Array audio cache.
- **Audio & DSP Engine (`src/audio/`)**:
  - `AudioEngine.ts`: Web Audio API wrapper, telemetry loop, tempo, transport sync.
  - `MasterBus.ts`: Dynamics compressor, master gain, stereo analyzer.
  - `TrackNode.ts`: Per-track gain, stereo panner, mute/solo, plugin chain.

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | Resilient Audio Startup & Toast | Protect `handleContinue`, `handleBlank`, and `handlePickFile` in `App.tsx` with `try...catch...finally` ensuring `busy` is cleared and `pushToast` alerts user on failure | M1 | ORIGINAL_REQUEST §R1 |
| F2 | AudioEngine Context Fallback | Fallback from 44.1kHz to native device sample rate on failure, capture `resume()` policy restrictions gracefully | M1 | ORIGINAL_REQUEST §R1 |
| F3 | Safe Demo & Blank Project Boot | Allow `loadDemoProject` and `createBlankProject` to proceed even if Web Audio context initialization fails | M1 | ORIGINAL_REQUEST §R1 |
| F4 | Pointer Events for WaveformCanvas | Migrate clip moving and trimming in `WaveformCanvas.tsx` to `onPointerDown`, `setPointerCapture`, `pointermove`, `pointerup`, `pointercancel` | M2 | ORIGINAL_REQUEST §R2 |
| F5 | Touch-Action None on Interactive Surfaces | Set `touch-action: none` on `WaveformCanvas.tsx` and `Knob.tsx` to prevent accidental viewport/container scrolling | M2 | ORIGINAL_REQUEST §R2 |
| F6 | Touch Ergonomic Trim Zones | Dynamic trim edge detection (20px on touch, 8px on mouse) and visible grab handles when clip is selected | M2 | ORIGINAL_REQUEST §R2 |
| F7 | Rotary Control Pointer Capture | Implement `setPointerCapture` and release in `Knob.tsx` with primary pointer enforcement | M2 | ORIGINAL_REQUEST §R2 |
| F8 | Touch Hitbox Standards (>=44x44px) | Expand hitboxes on Zoom, Cut, TrackHeader M/S/R, Delete Track, Transport Stop/Loop/Play, ChannelStrip M/S/R, Master Mute | M2 | ORIGINAL_REQUEST §R2 |
| F9 | UI Clip Deletion Action | Provide accessible Delete Clip button in Timeline toolbar so mobile users without physical keyboards can delete clips | M2 | ORIGINAL_REQUEST §R2 |
| F10 | Timeline Bidirectional Scroll Sync | Synchronize `scrollTop` between track headers container and audio waveform lanes container in `Timeline.tsx` with loop prevention | M3 | ORIGINAL_REQUEST §R3 |
| F11 | Sticky Ruler & Alignment | Make `Ruler.tsx` sticky at `top-0` in lanes container and keep background opaque | M3 | ORIGINAL_REQUEST §R3 |
| F12 | Ruler Horizontal Width Unification | Pass unified `totalWidth` or match width calculation in `Ruler.tsx` with lanes container to eliminate phantom horizontal scroll | M3 | ORIGINAL_REQUEST §R3 |
| F13 | Ruler Seek Clamping | Clamp seek position in `Ruler.tsx` so playhead cannot exceed project duration | M3 | ORIGINAL_REQUEST §R3 |
| F14 | Timeline 320px Usability & Adaptive Headers | Adapt track headers width (`w-36 sm:w-60`) on compact viewports to preserve space for audio lanes | M3 | ORIGINAL_REQUEST §R4 |
| F15 | Responsive Floating Toolbar | Compact zoom/cut/delete toolbar footprint (<80px on `<sm`), position at `bottom-2 right-2` without occluding lanes or headers | M3 | ORIGINAL_REQUEST §R4 |
| F16 | Responsive Header Layout | Prevent layout breakage down to 320px in `Header.tsx`, hide decorative badges, icon-only view switcher and actions on compact screens | M4 | ORIGINAL_REQUEST §R4 |
| F17 | Essential Transport Control Retention | Keep Metronome and Master VU Meter accessible and visible across all breakpoints (<640px) in `TransportBar.tsx` without unconditional hiding | M4 | ORIGINAL_REQUEST §R4 |
| F18 | Dual Track E2E Test Suite | 4-tier requirement-driven opaque-box test suite covering F1–F17, publishing `TEST_READY.md` | E2E Track | ORIGINAL_REQUEST Acceptance Criteria |
| F19 | E2E 100% Pass & Adversarial Hardening | Pass 100% of E2E tests across Tiers 1-4, followed by Tier 5 adversarial testing | M5 | Project Pattern Final Milestone |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| E2E | E2E Testing Track | Design test runner, test infrastructure, and Tiers 1-4 test suite per user requirements; publish `TEST_READY.md` | none | PLANNED |
| M1 | Resilient Audio Engine Startup (R1) | `src/App.tsx`, `src/audio/AudioEngine.ts`, `src/store/useDawStore.ts` — F1, F2, F3 | none | PLANNED |
| M2 | Touch Device Support & Gesture Ergonomics (R2) | `WaveformCanvas.tsx`, `Knob.tsx`, `TrackHeader.tsx`, `ChannelStrip.tsx` — F4, F5, F6, F7, F8, F9 | none | PLANNED |
| M3 | Timeline Geometry & Synchronization (R3 & Timeline R4) | `Timeline.tsx`, `Ruler.tsx` — F10, F11, F12, F13, F14, F15 | M2 | PLANNED |
| M4 | Responsive Layout & Control Retention (Header & Transport R4) | `Header.tsx`, `TransportBar.tsx` — F16, F17 | none | PLANNED |
| M5 | Final Milestone: 100% E2E Pass & Adversarial Hardening | Verify full E2E test suite passes (Tiers 1-4), then run Tier 5 adversarial gap analysis and fixes | E2E, M1, M2, M3, M4 | PLANNED |

---

## Interface Contracts

### M1 Boot Flow ↔ Audio Engine & Store
- `src/App.tsx`:
  - `handleContinue`: Enclosed in `try...catch...finally`. `finally { setBusy(null); }`.
  - `handleBlank`: Enclosed in `try...catch...finally`. `finally { setBusy(null); }`.
  - `handlePickFile`: Enclosed in `try...catch...finally`. `finally { setBusy(null); }`.
  - Catch handler logs error and invokes `pushToast('Aviso: Fallo o restricción en el motor de audio. Se inicia en modo silencioso.')`, calling `finishBoot()` to ensure user is not trapped.
- `src/audio/AudioEngine.ts`:
  - `ensureContext()`: Try `new AudioCtx({ latencyHint: 'interactive', sampleRate: 44100 })`. If rejected (e.g., `NotSupportedError`), retry with `new AudioCtx({ latencyHint: 'interactive' })`.
  - `ensureContext()`: Catch errors in `this.context.resume()` and warn instead of throwing.

### M2 Touch Gestures ↔ WaveformCanvas & Knob
- `src/components/Timeline/WaveformCanvas.tsx`:
  - Pointer events: `onPointerDown`, `setPointerCapture`, `onPointerMove`, `onPointerUp`, `onPointerCancel`.
  - Defensive capture: `if (target.setPointerCapture) target.setPointerCapture(pointerId)`.
  - `touch-action: none` on clip container.
  - Dynamic trim edge: `const edge = isTouch ? Math.min(20, width * 0.28) : Math.min(8, width * 0.2)`.
- `src/components/Plugins/Knob.tsx`:
  - `touch-action: none` on rotary dial and container.
  - `setPointerCapture` and `releasePointerCapture` with defensive checks.
  - Expanded touch hitbox (`before:absolute before:-inset-2.5`).

### M3 Timeline Geometry ↔ Ruler
- `src/components/Timeline/Timeline.tsx` ↔ `src/components/Timeline/Ruler.tsx`:
  - Pass `totalWidth` or calculate width identically: `const totalWidth = Math.max(viewportWidth - headerWidth, duration * zoom);`.
  - `Ruler` uses `sticky top-0 z-20 bg-dark-surface border-b border-dark-border`.
  - Bidirectional vertical scroll sync with re-entrancy flags (`isSyncingFromHeaders`, `isSyncingFromLanes`) and subpixel threshold guard (`> 0.5px`).
  - Seek time clamped to `[0, duration]`.

### M4 Responsive Layout ↔ Header & Transport
- `src/components/Header/Header.tsx`:
  - On compact viewports (<640px): hide "Local 100%" badge and text labels of switcher and action buttons.
  - Retain icons, tooltips, and `aria-label` for all actions.
- `src/components/Transport/TransportBar.tsx`:
  - Unconditional retention of Metronome: remove `hidden sm:inline-block`. Label displays "MET" on `<sm`, "CLICK" on `>=sm`.
  - Unconditional retention of Master VU Meter: remove `hidden sm:flex`. Render compact meter bar (`w-8 sm:w-14 h-3 sm:h-4`) on `<sm`.

---

## Code Layout & File Ownership
| File | Owning Milestone / Track | Read Access | Write Access |
|------|--------------------------|-------------|--------------|
| `src/App.tsx` | M1 | All | M1 Worker only |
| `src/audio/AudioEngine.ts` | M1 | All | M1 Worker only |
| `src/store/useDawStore.ts` | M1 | All | M1 Worker only |
| `src/tests/audioBootResilience.test.ts` | M1 | All | M1 Worker only |
| `src/components/Timeline/WaveformCanvas.tsx` | M2 | All | M2 Worker only |
| `src/components/Plugins/Knob.tsx` | M2 | All | M2 Worker only |
| `src/components/Timeline/TrackHeader.tsx` | M2 | All | M2 Worker only |
| `src/components/Mixer/ChannelStrip.tsx` | M2 | All | M2 Worker only |
| `src/tests/touchPointerErgonomics.test.ts` | M2 | All | M2 Worker only |
| `src/components/Timeline/Timeline.tsx` | M3 | All | M3 Worker only |
| `src/components/Timeline/Ruler.tsx` | M3 | All | M3 Worker only |
| `src/tests/timelineGeometry.test.ts` | M3 | All | M3 Worker only |
| `src/components/Header/Header.tsx` | M4 | All | M4 Worker only |
| `src/components/Transport/TransportBar.tsx` | M4 | All | M4 Worker only |
| `src/tests/responsiveRetention.test.ts` | M4 | All | M4 Worker only |
| `tests/e2e/**` | E2E Testing Track | All | E2E Worker only |
| `TEST_INFRA.md` | E2E Testing Track | All | E2E Orchestrator only |
| `TEST_READY.md` | E2E Testing Track | All | E2E Orchestrator only |
| `PROJECT.md` | Project Orchestrator | All | Project Orchestrator only |
