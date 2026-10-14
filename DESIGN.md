---
name: HydraDAW
description: High-performance 100% in-browser digital audio workstation with real-time DSP, Web Audio, and precision editing
colors:
  dark-bg: "#0a0d14"
  dark-surface: "#101522"
  dark-surface-light: "#182032"
  dark-border: "#1f2a40"
  dark-text: "#f1f5f9"
  dark-muted: "#94a3b8"
  primary: "#06b6d4"
  accent-cyan: "#06b6d4"
  accent-green: "#10b981"
  accent-red: "#ef4444"
  accent-amber: "#f59e0b"
  accent-purple: "#a855f7"
  accent-blue: "#3b82f6"
typography:
  display:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
  numeric:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.05em"
rounded:
  xs: "2px"
  sm: "4px"
  md: "6px"
  lg: "8px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#082f49"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  button-secondary:
    backgroundColor: "{colors.dark-surface-light}"
    textColor: "{colors.dark-text}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
---

# Design System: HydraDAW

## Overview
HydraDAW is a professional-grade browser DAW designed for low latency, zero visual clutter, and long studio sessions. The interface adheres to authentic DAW ergonomics (Logic Pro, Ableton Live, Bitwig), utilizing dark slate surfaces, high-contrast functional color coding, and tabular numerals for timing, metering, and parameter knobs.

## Colors
- **Surfaces**:
  - `dark-bg` (`#0a0d14`): Foundational canvas behind timelines and mixers.
  - `dark-surface` (`#101522`): Primary toolbars, channel strips, headers, and dialogs.
  - `dark-surface-light` (`#182032`): Active tracks, hovered controls, cards, and input backgrounds.
  - `dark-border` (`#1f2a40`): 1px structured grid separating channels, tracks, and rulers.
- **Accents & Roles**:
  - `primary / accent-cyan` (`#06b6d4`): Brand, transport active state, loop markers, primary focus rings, playhead.
  - `accent-green` (`#10b981`): Solo indicators, healthy audio levels (-60 to -6 dBFS), active DSP toggle.
  - `accent-amber` (`#f59e0b`): Warning metering (-6 to -0.1 dBFS), parameter automation overrides.
  - `accent-red` (`#ef4444`): Record arming, clip indicator (>= 0 dBFS), mute indicators.
  - `accent-purple` (`#a855f7`): Vocal tracks, FX sends, pitch plugins.

## Typography
- **Interface & UI**: Clean sans-serif stack (`Inter`, system UI). High legibility at small sizes (11px–13px) for dense mixer channel strips and timeline headers.
- **Brand Typography**: Solid, extra-bold tracking (`HydraDAW` with cyan accent), strictly refusing decorative gradient text.
- **Data & Meters**: Monospace and `tabular-nums` for timecodes (bars:beats:16ths, minutes:seconds:ms), peak dB readouts, knob values, and sample rates.

## Layout
- **Fixed Studio Framing**: Full-height application window (`100vh`, `overflow-hidden`), fixed top header and transport dock, collapsible bottom mixer, and virtualized/scrollable center timeline.
- **Alignment Grid**: Strict 1px borders, 4px/8px rhythm, and aligned timecode ruler intervals corresponding directly to musical beat subdivisions.

## Elevation & Depth
- Flat, industrial aesthetic without heavy artificial drop-shadows or faux neobrutalism.
- Modals and drawers use subtle darkened scrim overlays (`bg-black/70 backdrop-blur-xs`) and 1px borders (`border-dark-border`).
- Drag-and-drop overlays use subtle cyan tinted glow indicators.

## Shapes
- **Track Indicators**: Inset vertical accent bars (2px to 4px) along the left edge, matching track color.
- **Rounded Corners**: Compact border-radius (`rounded-md` / 6px) on buttons and cards; sharp 2px–4px on clips and audio waveforms for maximum editing precision.

## Components
- **Transport Bar**: Unified playback controls (Play, Pause, Record, Loop, Metronome, Tempo BPM, Time Signature, Master Volume, CPU/Audio Buffer load).
- **Track Header**: Color bar indicator, track type icon (Mic, Instrument, Audio), Mute/Solo buttons, FX rack button, volume slider, pan control.
- **Waveform Canvas**: High-DPI canvas rendering audio peaks with zero UI flickering, snap guides, and split slice lines.
- **Channel Strip**: Vertical faders with dB scale tick marks, peak LEDs, insert slots, and panning knobs.
- **Plugin Rack**: Modals and inline DSP nodes with rotary knobs responding to vertical drag, double-click to reset, and real-time bypass.

## Do's and Don'ts
### Do's
- **DO** use `font-variant-numeric: tabular-nums` for all time, meter, frequency, and gain values.
- **DO** maintain strict >= 4.5:1 contrast on all labels and controls.
- **DO** provide clear `:focus-visible` rings (`#06b6d4`) for keyboard accessibility.
- **DO** theme browser surfaces (selection, caret, scrollbars) with the dark cyan DAW palette.

### Don'ts
- **DON'T** use gradient text (`bg-clip-text bg-gradient`) for branding, headings, or metrics.
- **DON'T** use thick colored `border-l-4` side-tabs on cards or headers.
- **DON'T** rely on monospace for arbitrary body text; reserve it strictly for timecodes, measurements, and code editors.
- **DON'T** use floating unanchored modals for quick single-click adjustments.
