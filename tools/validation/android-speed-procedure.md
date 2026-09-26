# Android/WebView time-control validation procedure (issue #37 / PR #46)

Status: PROCEDURE ONLY — no device is available in this environment (no
attached devices, no system images, no KVM). Do not claim Android
performance until this procedure has been executed on hardware and its
results recorded below.

## Prerequisites

- Debug APK built from the PR #46 head (`pnpm --filter @digital-evolution/explorer build`,
  `cap sync android`, `./gradlew assembleDebug`, or the `apk` CI artifact).
- One supported Android device with WebView (record model + OS + WebView version).

## Bounded runtime check (~10 minutes)

1. Install and launch the APK. Note the device model, Android version, WebView version.
2. On the default universe, open World. For each speed 1×, 10×, 100×, Max:
   - select the speed, tap Play, count HUD ticks over a 30-second window
     (use a stopwatch; record start/end tick), tap Pause.
   - record ticks advanced per mode.
3. Required semantic ordering: 1× < 10× < 100×. 100× and Max may plateau
   together if device/engine throughput is the limit (expected; Max must
   still behave as unbounded fast-forward, not a fixed multiple).
4. Pause responsiveness: at Max, tap Pause — the tick counter must stop
   within ~2 seconds and the UI must remain responsive.
5. Decision gating at high speed: at Max, tap "Next meaningful change"
   until a decision sheet appears; assert simulation time does not advance
   while the sheet is pending, then resolve with Keep watching.

## Recording results

Append a dated section below with the device info, the four throughput
numbers, pause latency, gating result, and the tester name. Example:

### 2026-XX-XX — <device>, Android <v>, WebView <v> — <tester>
- 1×: N ticks/30s; 10×: N; 100×: N; Max: N — ordering 1<10<100 (Y/N)
- Pause at Max: <latency> — responsive (Y/N)
- Decision gate at Max: held (Y/N)

## Results

(none yet — pending device access)
