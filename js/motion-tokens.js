// Motion presets for animations driven by Motion (js/vendor/motion.js). Every Motion animation
// uses one of these and nothing else. Springs are set by how long they look (visualDuration, s)
// and how much they overshoot (bounce).
import { spring } from './vendor/motion.js';

export const tap = { type: spring, visualDuration: 0.15, bounce: 0 };         // button press feedback
export const fast = { type: spring, visualDuration: 0.25, bounce: 0.15 };     // toggles, chips, small reveals
const standard = { type: spring, visualDuration: 0.35, bounce: 0.2 };        // cards, list items, panels
export const expressive = { type: spring, visualDuration: 0.5, bounce: 0.3 }; // Voice Orb, bottom sheets, set-saved confirmation
export const fade = { duration: 0.2, ease: 'easeOut' };                       // colour and opacity only, never springy

// "default" can't be a variable name, so it lives here (and as the default export)
export const presets = { tap, fast, default: standard, expressive, fade };
export default standard;

// A spring preset as a CSS/Web Animations easing: { duration (ms), easing: 'linear(…)' }, for the
// places that animate without Motion (CSS rules via css/motion.css, element.animate()).
export function cssSpring(name) {
  const p = presets[name];
  const [dur, ...easing] = String(spring(p.visualDuration, p.bounce)).split(' ');
  return { duration: parseFloat(dur), easing: easing.join(' ') };
}

// No movement when the phone asks for reduced motion, or Settings → Motion is off.
export function reducedMotion() {
  const m = document.documentElement.dataset.motion;
  return m === 'off' || (m !== 'on' && matchMedia('(prefers-reduced-motion: reduce)').matches);
}
