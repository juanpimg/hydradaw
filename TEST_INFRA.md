# HydraDAW — Test Infrastructure Specification (TEST_INFRA.md)

## 1. Testing Philosophy & Principles

The HydraDAW test architecture follows a strict **requirement-driven, opaque-box (black-box)** methodology designed for dual-track engineering in client-side Web Audio applications:

1. **Requirement-Driven**: Every test case traces directly to an explicit requirement in `ORIGINAL_REQUEST.md` (R1–R4) and interface contract in `PROJECT.md` (F1–F17).
2. **Opaque-Box Verification**: Tests validate observable public contracts, state store actions (`useDawStore`), audio engine state transitions, DOM layout invariants, accessibility attributes, and user event mechanics. Implementation details and private structures are never coupled to tests.
3. **Deterministic Oracle Derivation**: Expected outputs are derived mathematically from specification bounds (e.g., minimum 44x44px hitboxes, clamped bounds `[0, duration]`, minimum 0.2s clip duration, exact fallback sequences for Web Audio API context initialization).
4. **Progressive Testability**: The test suite is organized modularly by feature sets (Milestones M1–M4) and tiers. During incremental implementation, milestone suites verify their respective contracts without circular dependencies on unmerged features.
5. **Adversarial & Boundary Rigor**: Tests explicitly probe edge cases, rapid repeated interactions, floating-point drift, invalid media payloads, and constrained viewports down to 320px.

---

## 2. Feature Inventory Mapping (F1–F17)

| Feature | Description | Milestone | Source Requirement | Target Test Suite |
|---------|-------------|-----------|--------------------|-------------------|
| **F1** | Resilient Audio Startup & Toast | M1 | ORIGINAL_REQUEST §R1 | `src/tests/e2e/tier1_m1_m2_features.test.ts` / `tier2_m1_m2_boundaries.test.ts` |
| **F2** | AudioEngine Context Fallback | M1 | ORIGINAL_REQUEST §R1 | `src/tests/e2e/tier1_m1_m2_features.test.ts` / `tier2_m1_m2_boundaries.test.ts` |
| **F3** | Safe Demo & Blank Project Boot | M1 | ORIGINAL_REQUEST §R1 | `src/tests/e2e/tier1_m1_m2_features.test.ts` / `tier2_m1_m2_boundaries.test.ts` |
| **F4** | Pointer Events for WaveformCanvas | M2 | ORIGINAL_REQUEST §R2 | `src/tests/e2e/tier1_m1_m2_features.test.ts` / `tier2_m1_m2_boundaries.test.ts` |
| **F5** | Touch-Action None on Interactive Surfaces | M2 | ORIGINAL_REQUEST §R2 | `src/tests/e2e/tier1_m1_m2_features.test.ts` / `tier2_m1_m2_boundaries.test.ts` |
| **F6** | Touch Ergonomic Trim Zones | M2 | ORIGINAL_REQUEST §R2 | `src/tests/e2e/tier1_m1_m2_features.test.ts` / `tier2_m1_m2_boundaries.test.ts` |
| **F7** | Rotary Control Pointer Capture | M2 | ORIGINAL_REQUEST §R2 | `src/tests/e2e/tier1_m1_m2_features.test.ts` / `tier2_m1_m2_boundaries.test.ts` |
| **F8** | Touch Hitbox Standards (>=44x44px) | M2 | ORIGINAL_REQUEST §R2 | `src/tests/e2e/tier1_m1_m2_features.test.ts` / `tier2_m1_m2_boundaries.test.ts` |
| **F9** | UI Clip Deletion Action | M2 | ORIGINAL_REQUEST §R2 | `src/tests/e2e/tier1_m1_m2_features.test.ts` / `tier2_m1_m2_boundaries.test.ts` |
| **F10** | Timeline Bidirectional Scroll Sync | M3 | ORIGINAL_REQUEST §R3 | `src/tests/e2e/tier1_m3_m4_features.test.ts` / `tier2_m3_m4_boundaries.test.ts` |
| **F11** | Sticky Ruler & Alignment | M3 | ORIGINAL_REQUEST §R3 | `src/tests/e2e/tier1_m3_m4_features.test.ts` / `tier2_m3_m4_boundaries.test.ts` |
| **F12** | Ruler Horizontal Width Unification | M3 | ORIGINAL_REQUEST §R3 | `src/tests/e2e/tier1_m3_m4_features.test.ts` / `tier2_m3_m4_boundaries.test.ts` |
| **F13** | Ruler Seek Clamping | M3 | ORIGINAL_REQUEST §R3 | `src/tests/e2e/tier1_m3_m4_features.test.ts` / `tier2_m3_m4_boundaries.test.ts` |
| **F14** | Timeline 320px Usability & Adaptive Headers | M3 | ORIGINAL_REQUEST §R4 | `src/tests/e2e/tier1_m3_m4_features.test.ts` / `tier2_m3_m4_boundaries.test.ts` |
| **F15** | Responsive Floating Toolbar | M3 | ORIGINAL_REQUEST §R4 | `src/tests/e2e/tier1_m3_m4_features.test.ts` / `tier2_m3_m4_boundaries.test.ts` |
| **F16** | Responsive Header Layout | M4 | ORIGINAL_REQUEST §R4 | `src/tests/e2e/tier1_m3_m4_features.test.ts` / `tier2_m3_m4_boundaries.test.ts` |
| **F17** | Essential Transport Control Retention | M4 | ORIGINAL_REQUEST §R4 | `src/tests/e2e/tier1_m3_m4_features.test.ts` / `tier2_m3_m4_boundaries.test.ts` |

---

## 3. Test Architecture & Directory Layout

The E2E test suite resides under `src/tests/e2e/` and runs natively using Vitest:

```
src/tests/e2e/
├── helpers/
│   └── testHelpers.ts                 # Shared mock factories, DOM/event simulation, store resets
├── tier1_m1_m2_features.test.ts       # Tier 1: F1–F9 Feature Coverage (>=5 test cases per feature)
├── tier1_m3_m4_features.test.ts       # Tier 1: F10–F17 Feature Coverage (>=5 test cases per feature)
├── tier2_m1_m2_boundaries.test.ts     # Tier 2: F1–F9 Boundary & Corner Cases (>=5 test cases per feature)
├── tier2_m3_m4_boundaries.test.ts     # Tier 2: F10–F17 Boundary & Corner Cases (>=5 test cases per feature)
├── tier3_combinations.test.ts         # Tier 3: Pairwise Cross-Feature Interactions (12 test cases)
└── tier4_scenarios.test.ts            # Tier 4: Real-World End-to-End Workflows (6 test cases)
```

### Test Runner Commands

- **Run all E2E tests**:
  ```bash
  npx vitest run src/tests/e2e
  ```
- **Run complete project test suite** (unit + integration + E2E):
  ```bash
  npm test
  ```
- **Run specific tier**:
  ```bash
  npx vitest run src/tests/e2e/tier1_m1_m2_features.test.ts
  npx vitest run src/tests/e2e/tier2_m1_m2_boundaries.test.ts
  npx vitest run src/tests/e2e/tier3_combinations.test.ts
  npx vitest run src/tests/e2e/tier4_scenarios.test.ts
  ```

---

## 4. 4-Tier Test Methodology

### Tier 1: Feature Coverage (>=5 tests per feature)
Verifies the nominal and standard operating paths for each individual feature:
- **F1 (Resilient Audio Startup & Toast)**: `handleContinue`, `handleBlank`, and `handlePickFile` boot resilience, toast notification on audio failure, `busy` flag cleared in `finally`, file error handling, transition into workspace.
- **F2 (AudioEngine Context Fallback)**: Initial 44.1kHz attempt, automatic native sample-rate fallback on `NotSupportedError`, graceful handling of `resume()` autoplay restrictions, singleton context reuse, environment detection.
- **F3 (Safe Demo & Blank Project Boot)**: `loadDemoProject` succeeds silently on context failure, `createBlankProject` cleanses state and stops previous engine, finishBoot triggers initial autosave snapshot, duration & BPM defaults set, workspace is unblocked.
- **F4 (Pointer Events for WaveformCanvas)**: Pointer down/move/up event cycle, defensive `setPointerCapture` execution, multi-pointer device support (mouse, touch, pen), pointercancel event handling, clean listener cleanup.
- **F5 (Touch-Action None on Interactive Surfaces)**: CSS `touch-action: none` / `touch-none` enforcement on WaveformCanvas clip elements, Knob rotary dial element, scroll prevention verification, non-interactive parent isolation.
- **F6 (Touch Ergonomic Trim Zones)**: Dynamic trim edge computation (up to 20px on touch, up to 8px on mouse), narrow clip (<24px) drag priority, left trim delta clamping, right trim duration clamping, minimum 0.2s duration preservation.
- **F7 (Rotary Control Pointer Capture)**: Pointer capture with primary pointer enforcement (`e.isPrimary`), vertical delta mapping to parameter change, floating-point drift elimination via step precision, keyboard arrows & double-click reset, pointer cancellation.
- **F8 (Touch Hitbox Standards >=44x44px)**: Zoom In/Out toolbar buttons, Cut button, TrackHeader Mute/Solo/Arm buttons (`w-11 h-11`), Delete Track button hitbox, Transport controls, ChannelStrip controls, Master Mute.
- **F9 (UI Clip Deletion Action)**: Toolbar Delete button presence, disabled state when no clip selected, enabled state when clip selected, `removeClip` action invocation, accessibility attributes (`aria-label`).
- **F10 (Timeline Bidirectional Scroll Sync)**: Track headers scroll updates lanes `scrollTop`, lanes scroll updates track headers `scrollTop`, loop prevention guard (`isSyncingFrom...`), subpixel threshold (>0.5px), dynamic track list resilience.
- **F11 (Sticky Ruler & Alignment)**: Ruler sticky positioning (`sticky top-0 z-20`), opaque background styling (`bg-dark-surface`), z-index ordering above waveform lanes, horizontal scroll alignment, playhead cursor alignment.
- **F12 (Ruler Horizontal Width Unification)**: Identical width calculation (`Math.max(viewportWidth - headerWidth, duration * zoom)`), elimination of phantom horizontal scrollbars, zoom scaling reactivity, duration change responsiveness, zero discrepancy between ruler and lane containers.
- **F13 (Ruler Seek Clamping)**: Playhead seek clamped to `[0, duration]`, rejection of negative time seeks, rejection of past-duration seeks, exact boundary seeking at 0.0s and project end, floating-point click coordinate normalization.
- **F14 (Timeline 320px Usability & Adaptive Headers)**: Track header width adapts responsively (`w-36` on mobile <640px, `w-60` on desktop), 320px viewport retains >=170px for waveform lanes, header controls scale without overflow, track selection functions on compact screens.
- **F15 (Responsive Floating Toolbar)**: Floating toolbar compact footprint (<80px / responsive wrapping) on `<sm`, positioning at `bottom-2 right-2` without occluding headers or lanes, button tap accessibility, cut button state synchronization.
- **F16 (Responsive Header Layout)**: Compact 320px layout preservation, decorative badge ("Local 100%") hidden on `<sm`, view switcher and action button text hidden on `<sm` with icons retained, full `aria-label` retention, header maintains single-row height.
- **F17 (Essential Transport Control Retention)**: Unconditional metronome retention (no unconditional `hidden`), metronome displays "MET" on `<sm` and "CLICK" on `>=sm`, unconditional Master VU meter retention (`w-8 sm:w-14`), live meter responsiveness across breakpoints.

*Total Tier 1 Target: 17 features × 5 test cases = 85 tests.*

---

### Tier 2: Boundary & Corner Cases (>=5 tests per feature)
Probes limits, degenerate inputs, hardware constraints, and extreme conditions:
- **F1**: Empty file imports, non-JSON corrupted files, network/IO permission errors, rapid consecutive boot clicks, simultaneous import and blank project triggers.
- **F2**: Context creation throwing generic Error, sample rates of 96kHz/192kHz, context state stuck in `'closed'`, zero-sample-rate audio environment, context resume rejecting with SecurityError.
- **F3**: Blank project creation with existing 50-track project, demo project loaded while transport is playing, project duration 0s fallback, extreme tempo (260 BPM) reset, memory cleanup of previous audio buffers.
- **F4**: Rapid pointerdown/pointerup within 1ms, pointer movement with deltaX = 0, multi-touch simultaneous pointer IDs, pointer event with missing `setPointerCapture` on target, pointer release outside viewport.
- **F5**: Nested scroll container touch-action verification, dynamic style updates, touch-action style retention during drag state changes, touch-action presence on newly added tracks.
- **F6**: Trimming a 0.2s minimum clip (cannot shrink further), trimming past project end duration, trimming with zero audioBuffer duration, negative offset compensation, sub-pixel trim delta (<0.01px).
- **F7**: Dragging knob 10,000px beyond maximum, dragging knob to negative infinity, knob with step = 0.0001, rapid pointer reversal during drag, secondary touch points during active primary drag.
- **F8**: Hitboxes on screens with devicePixelRatio = 3, hitboxes inside scrolled containers, hitboxes with focus outlines, hitboxes when track is armed vs disarmed, hover vs active target expansion.
- **F9**: Deleting a clip that was already removed, deleting clip during active playback, keyboard shortcut 'Delete' while dialog is focused, rapid double-tap on UI delete button, deleting clip from empty track.
- **F10**: Rapid alternating scroll events between headers and lanes (stress test), fractional subpixel scroll deltas (0.1px, 0.4px), scroll event with target scrolled to maximum bottom, zero tracks scroll behavior, scroll sync when viewport resizes.
- **F11**: Ruler rendering at 1000s duration, ruler rendering at zoom = 1 px/s, ruler rendering at zoom = 500 px/s, ruler ticks in odd time signatures (7/8, 5/4), sticky positioning stability during vertical fling.
- **F12**: Ruler width with duration = 0.1s, ruler width with 0px viewport, zoom = 0 protection, total width with 100 tracks, width calculation with fractional zoom levels (33.333 px/s).
- **F13**: Seek click with clientX = -9999px, seek click with clientX = +9999px, seek at exact boundary (duration - 0.0001s), seek during active playback, seek with zoom = 1000.
- **F14**: Timeline at exactly 320px screen width, timeline at 280px ultra-compact screen, track name with 200 characters in 144px header, 0 tracks layout at 320px, 30 tracks layout at 320px.
- **F15**: Floating toolbar when right edge touches screen border, floating toolbar with zoom level at minimum (10 px/s), floating toolbar with zoom level at maximum (200 px/s), rapid toggle between zoom in and zoom out.
- **F16**: Header at 320px with project name = 100 characters, header when all actions are triggered sequentially, header layout when window resized from 1920px to 320px in single frame, header with active dropdowns.
- **F17**: Transport bar at 320px with BPM = 260, time display formatting at hour boundary (3600s), master peak meter clipping at +6 dBFS, rapid metronome toggling (100 times), transport loop range with start = end.

*Total Tier 2 Target: 17 features × 5 test cases = 85 tests.*

---

### Tier 3: Cross-Feature Combinations (Pairwise Interactions)
Validates system behavior when multiple features interact concurrently:
1. **F1 + F3**: Safe fallback boot allows full blank project creation without throwing audio exceptions.
2. **F4 + F5 + F6**: Touch-driven clip trimming on WaveformCanvas with dynamic edge detection and pointer capture without parent scroll interference.
3. **F6 + F9**: Clip selection visual handles and subsequent deletion via UI toolbar button.
4. **F7 + F8**: Rotary dial adjustments with pointer capture in close proximity to 44px channel strip controls.
5. **F10 + F11 + F12**: Vertical scroll synchronization with sticky ruler overlay across unified track width.
6. **F12 + F13**: Seeking near maximum unified width clamps safely to duration.
7. **F14 + F15 + F16**: 320px mobile layout cohesion: compact header, adaptive 144px track headers, and responsive floating toolbar.
8. **F16 + F17**: Compact header navigation concurrently with retained metronome and live metering in transport bar.
9. **F4 + F10**: Clip dragging across vertically synchronized tracks without losing scroll position.
10. **F2 + F17**: Audio engine running under suspended audio context updates telemetry and transport metrics gracefully.
11. **F8 + F9 + F15**: Floating toolbar buttons meet 44px touch targets while housing delete clip and zoom controls.
12. **F13 + F17**: Ruler seek updates transport bar high-resolution time display, bar/beat indicators, and playback position.

*Total Tier 3 Target: 12 pairwise test cases.*

---

### Tier 4: Real-World Scenarios (End-to-End Workflows)
Exercises complete, multi-step application user journeys:
1. **Scenario 1: Mobile Touch Recording & Arrangement Workflow (320px)**:
   Launch on mobile, create blank project, add vocal track, arm with 44px touch button, enable metronome, record audio take, trim edges with touch grab handle, and delete unwanted clip via UI toolbar.
2. **Scenario 2: Tablet Multi-Track Production & Splitting Session**:
   Load demo project, scroll vertically across 6 tracks with sticky ruler and synchronized headers, zoom in via floating toolbar, seek playhead to beat boundary, split clip, trim slice, and reposition slice with magnetic snapping.
3. **Scenario 3: Resilient Audio Failure & Silent Editing Session**:
   Simulate browser autoplay/sample-rate rejection during startup, receive non-blocking toast, enter workspace smoothly, rename project, adjust mixer faders, add tracks, and verify autosave snapshots persist.
4. **Scenario 4: Responsive Mixing Console & Live Transport Control**:
   Switch between Timeline and Mixer on a 375px mobile viewport, adjust plugin knobs with pointer capture, toggle track mutes via 44px buttons, adjust master volume, and monitor live master VU meter without layout distortion.
5. **Scenario 5: Full Project Composition & Master Export Preparation**:
   Create project, add 4 tracks (Drums, Bass, Guitar, Lead), import audio clips, set 128 BPM and 4/4 time signature, configure loop range in transport bar, verify ruler width matches duration, and launch master/export dialog.
6. **Scenario 6: High-Stress Boundary Session**:
   Perform rapid resizing (1920px -> 320px), seek past duration, trim clips to 0.2s minimum limit, rapid-click zoom controls, and verify complete state consistency and zero unhandled rejections.

*Total Tier 4 Target: 6 workflow scenarios.*

---

## 5. Summary Matrix & Coverage Counts

| Test Tier | Focus Area | Minimum Target | Actual Count |
|-----------|------------|----------------|--------------|
| **Tier 1** | Feature Coverage (F1–F17) | 85 (5/feature) | 85 |
| **Tier 2** | Boundary & Corner Cases (F1–F17) | 85 (5/feature) | 85 |
| **Tier 3** | Cross-Feature Pairwise Interactions | 10 | 12 |
| **Tier 4** | Real-World Application Workflows | 5 | 6 |
| **Total** | Full E2E Test Suite | **185** | **188** |
