// Every haptic the game plays, by name.
//
// THIS FILE IS A FIXED CONTRACT. FreeMilk reads it to list the game's haptics, and
// it is written by the set_haptic and remove_haptic tools — not by hand.
//
// An effect is a pattern: events on a timeline, in seconds.
//   type       'transient' (an instantaneous tap) or 'continuous' (a buzz)
//   time       when it fires, relative to the start
//   intensity  0-1, how hard it hits
//   sharpness  0-1, a dull thud at 0, a crisp tick at 1
//   duration   continuous events only, seconds
//
// Events also take an envelope — attackTime, decayTime, releaseTime,
// sustained. A pattern may carry curves that ramp intensity or sharpness
// smoothly, and may loop, set a playbackRate, or be sustained so the game can
// change it while it runs.
//
// There is no web haptics API on iOS: this goes through the app to the Taptic
// Engine, so it does nothing when the game is opened in a plain browser.

export const HAPTICS = {
  'tap-hit': { events: [{ intensity: 0.55, sharpness: 0.75, time: 0, type: 'transient' }] },

  'perfect-hit': { events: [{ intensity: 0.95, sharpness: 0.9, time: 0, type: 'transient' }, { intensity: 0.4, sharpness: 1, time: 0.05, type: 'transient' }] },

  'hold-pass': { events: [{ intensity: 0.6, sharpness: 0.6, time: 0, type: 'transient' }, { intensity: 0.5, sharpness: 0.9, time: 0.09, type: 'transient' }, { intensity: 0.7, sharpness: 0.5, time: 0.2, type: 'transient' }] },

  'combo-milestone': { events: [{ duration: 0.16, intensity: 0.5, sharpness: 0.4, sustained: 0, time: 0, type: 'continuous' }, { intensity: 0.8, sharpness: 0.8, time: 0.2, type: 'transient' }] },

  countdown: { events: [{ intensity: 0.35, sharpness: 0.5, time: 0, type: 'transient' }] },

  'countdown-go': { events: [{ duration: 0.2, intensity: 0.7, sharpness: 0.5, sustained: 0, time: 0, type: 'continuous' }, { intensity: 1, sharpness: 1, time: 0.22, type: 'transient' }] },

  'miss-hit': { events: [{ attackTime: 0.004, decayTime: 0.09, duration: 0.1, intensity: 0.85, sharpness: 0.12, sustained: 0, time: 0, type: 'continuous' }, { intensity: 0.3, sharpness: 0.2, time: 0.12, type: 'transient' }] }
};

const channel =
  typeof window !== 'undefined' &&
  window.webkit &&
  window.webkit.messageHandlers &&
  window.webkit.messageHandlers.milqHaptics;

function send(payload) {
  if (channel) channel.postMessage(payload);
}

/// Plays a named haptic. Unknown names are ignored rather than throwing, so a
/// renamed effect never crashes a scene mid-frame.
///
/// Pass an id for an effect you intend to change or stop while it runs —
/// looping and sustained effects only. One-shots need no id.
export function haptic(name, id) {
  const effect = HAPTICS[name];
  if (!effect) return;
  send(id ? { ...effect, action: 'play', id } : effect);
}

/// Changes an effect that is already playing: intensity, sharpness or
/// playbackRate. Only reaches effects started with an id.
export function hapticUpdate(id, params) {
  send({ action: 'update', id, ...params });
}

/// Stops one running effect, or every one when called with no id.
export function hapticStop(id) {
  send({ action: 'stop', id });
}