/**
 * ═══════════════════════════════════════════════════════════════
 *  TESTOCAN — Shared Message Protocol
 * ═══════════════════════════════════════════════════════════════
 *  Central contract for all chrome.runtime message passing.
 *  Every message between Background ↔ Content ↔ Popup uses
 *  this schema to avoid magic strings.
 */

export const MSG = Object.freeze({
  // ── Recording lifecycle ──────────────────────────────────────
  START_RECORDING:   'TESTOCAN::START_RECORDING',
  STOP_RECORDING:    'TESTOCAN::STOP_RECORDING',
  RECORDING_STARTED: 'TESTOCAN::RECORDING_STARTED',
  RECORDING_STOPPED: 'TESTOCAN::RECORDING_STOPPED',

  // ── Recorded events ──────────────────────────────────────────
  DOM_EVENT:         'TESTOCAN::DOM_EVENT',

  // ── State queries ────────────────────────────────────────────
  GET_STATUS:        'TESTOCAN::GET_STATUS',
  STATUS_RESPONSE:   'TESTOCAN::STATUS_RESPONSE',

  // ── Replay (future) ──────────────────────────────────────────
  START_REPLAY:      'TESTOCAN::START_REPLAY',
  REPLAY_STEP:       'TESTOCAN::REPLAY_STEP',
  REPLAY_COMPLETE:   'TESTOCAN::REPLAY_COMPLETE',
});
