// Little moving figures that show how an exercise is done. Pure: joint positions for the start
// (a) and end (b) of about thirty movements → SVG path strings with the same shape, so the UI can
// morph one into the other. Side view facing right unless noted; viewBox 0 -10 64 72, floor at y 56.

const J = ['h', 'n', 'e1', 'w1', 'e2', 'w2', 'p', 'k1', 'f1', 'k2', 'f2'];
const std = { h: [32, 10], n: [32, 15], e1: [32, 24], w1: [32, 33], p: [32, 34], k1: [33, 45], f1: [31, 56] };
const seat = { h: [28, 18], n: [28, 23], p: [28, 42], k1: [40, 42], f1: [40, 56] };
const lie = { h: [12, 33], n: [17, 35], p: [36, 36], k1: [46, 40], f1: [47, 56] }; // on a bench, head left
const up = (o, ...rest) => Object.assign({}, o, ...rest);

// scene: static lines drawn under the figure. prop: what the hands hold.
export const PATTERNS = {
  squat: { prop: 'plate', a: up(std, { e1: [26, 20], w1: [30, 15] }), b: { h: [35, 19], n: [32, 24], e1: [25, 29], w1: [31, 21], p: [23, 42], k1: [36, 44], f1: [31, 56] } },
  goblet: { prop: 'kb', a: up(std, { e1: [34, 24], w1: [38, 19] }), b: { h: [35, 19], n: [32, 24], e1: [35, 32], w1: [39, 27], p: [23, 42], k1: [36, 44], f1: [31, 56] } },
  legpress: { prop: 'sled', scene: 'M6 50 L22 30', a: { h: [9, 25], n: [12, 30], e1: [17, 38], w1: [24, 42], p: [22, 44], k1: [29, 33], f1: [38, 40] }, b: { h: [9, 25], n: [12, 30], e1: [17, 38], w1: [24, 42], p: [22, 44], k1: [33, 38], f1: [45, 33] } },
  deadlift: { prop: 'plate', a: { h: [45, 24], n: [40, 28], e1: [40, 38], w1: [40, 47], p: [24, 40], k1: [37, 45], f1: [32, 56] }, b: up(std, { w1: [32, 33] }) },
  rdl: { prop: 'plate', a: std, b: { h: [47, 23], n: [42, 25], e1: [42, 34], w1: [42, 43], p: [26, 35], k1: [34, 45], f1: [31, 56] } },
  swing: { prop: 'kb', a: { h: [46, 26], n: [41, 28], e1: [37, 36], w1: [32, 43], p: [25, 38], k1: [35, 46], f1: [31, 56] }, b: up(std, { e1: [41, 17], w1: [50, 18] }) },
  clean: { prop: 'plate', a: { h: [45, 24], n: [40, 28], e1: [40, 38], w1: [40, 47], p: [24, 40], k1: [37, 45], f1: [32, 56] }, b: up(std, { e1: [38, 22], w1: [36, 15] }) },
  backext: { scene: 'M14 40 L30 40', a: { h: [37, 55], n: [35, 50], e1: [41, 46], w1: [36, 42], p: [28, 36], k1: [18, 38], f1: [8, 40] }, b: { h: [52, 32], n: [47, 34], e1: [51, 39], w1: [45, 38], p: [28, 36], k1: [18, 38], f1: [8, 40] } },
  hipthrust: { scene: 'M4 36 L16 36', prop: 'plate', a: { h: [9, 30], n: [13, 34], e1: [18, 40], w1: [26, 44], p: [26, 48], k1: [38, 41], f1: [40, 56] }, b: { h: [9, 30], n: [13, 34], e1: [20, 36], w1: [28, 34], p: [28, 34], k1: [38, 40], f1: [40, 56] } },
  bench: { scene: 'M6 40 L42 40 M14 40 L14 56 M36 40 L36 56', prop: 'plate', a: up(lie, { e1: [12, 42], w1: [18, 33] }), b: up(lie, { e1: [20, 26], w1: [21, 16] }) },
  incline: { scene: 'M8 24 L30 42 L40 42 M30 42 L30 56', prop: 'plate', a: { h: [13, 22], n: [17, 26], e1: [12, 34], w1: [19, 27], p: [32, 40], k1: [42, 42], f1: [44, 56] }, b: { h: [13, 22], n: [17, 26], e1: [24, 18], w1: [28, 9], p: [32, 40], k1: [42, 42], f1: [44, 56] } },
  fly: { scene: 'M6 40 L42 40 M14 40 L14 56 M36 40 L36 56', prop: 'db', a: up(lie, { e1: [13, 43], w1: [9, 50] }), b: up(lie, { e1: [19, 26], w1: [20, 16] }) },
  chestpress: { scene: 'M22 42 L34 42 M22 42 L20 18', a: up(seat, { e1: [22, 29], w1: [31, 25] }), b: up(seat, { e1: [37, 23], w1: [47, 23] }) },
  crossover: { prop: 'cable', anchor: [58, 4], a: up(std, { e1: [30, 23], w1: [40, 18] }), b: up(std, { e1: [39, 22], w1: [46, 28] }) },
  pushup: { a: { h: [52, 49], n: [47, 51], e1: [40, 49], w1: [46, 56], p: [28, 53], k1: [18, 54], f1: [8, 56] }, b: { h: [51, 36], n: [46, 38], e1: [46, 47], w1: [46, 56], p: [28, 46], k1: [18, 51], f1: [8, 56] } },
  dip: { scene: 'M26 31 L44 31', a: { h: [33, 20], n: [32, 25], e1: [24, 29], w1: [34, 31], p: [31, 43], k1: [26, 52], f1: [33, 58] }, b: { h: [32, 10], n: [32, 15], e1: [33, 23], w1: [34, 31], p: [31, 34], k1: [26, 43], f1: [33, 49] } },
  row: { prop: 'plate', a: { h: [47, 23], n: [42, 26], e1: [42, 36], w1: [42, 46], p: [26, 36], k1: [34, 45], f1: [30, 56] }, b: { h: [47, 23], n: [42, 26], e1: [34, 31], w1: [39, 38], p: [26, 36], k1: [34, 45], f1: [30, 56] } },
  cablerow: { prop: 'cable', anchor: [60, 44], a: { h: [26, 24], n: [25, 29], e1: [33, 32], w1: [42, 33], p: [23, 48], k1: [36, 44], f1: [46, 48] }, b: { h: [24, 24], n: [23, 29], e1: [15, 34], w1: [25, 36], p: [23, 48], k1: [36, 44], f1: [46, 48] } },
  pullup: { scene: 'M20 4 L46 4', a: { h: [32, 19], n: [32, 24], e1: [33, 14], w1: [33, 4], p: [32, 43], k1: [30, 52], f1: [35, 59] }, b: { h: [34, 0], n: [32, 6], e1: [24, 11], w1: [31, 4], p: [32, 25], k1: [30, 34], f1: [35, 42] } },
  pulldown: { prop: 'cable', anchor: [33, -10], scene: 'M20 42 L36 42', a: up(seat, { e1: [30, 13], w1: [32, 3] }), b: up(seat, { e1: [22, 31], w1: [31, 22] }) },
  straightarm: { prop: 'cable', anchor: [58, -6], a: up(std, { h: [35, 11], n: [34, 16], e1: [42, 12], w1: [50, 9] }), b: up(std, { h: [35, 11], n: [34, 16], e1: [36, 26], w1: [38, 36] }) },
  ohp: { prop: 'plate', a: up(std, { e1: [37, 23], w1: [37, 15] }), b: up(std, { e1: [33, 5], w1: [33, -4] }) },
  raise: { front: true, a: { h: [32, 10], n: [32, 15], e1: [27, 24], w1: [26, 33], e2: [37, 24], w2: [38, 33], p: [32, 34], k1: [29, 45], f1: [28, 56], k2: [35, 45], f2: [36, 56] }, b: { h: [32, 10], n: [32, 15], e1: [23, 16], w1: [14, 17], e2: [41, 16], w2: [50, 17], p: [32, 34], k1: [29, 45], f1: [28, 56], k2: [35, 45], f2: [36, 56] } },
  reardelt: { prop: 'db', a: { h: [47, 23], n: [42, 26], e1: [42, 36], w1: [42, 46], p: [26, 36], k1: [34, 45], f1: [30, 56] }, b: { h: [47, 23], n: [42, 26], e1: [37, 18], w1: [33, 10], p: [26, 36], k1: [34, 45], f1: [30, 56] } },
  facepull: { prop: 'cable', anchor: [60, 12], a: up(std, { e1: [40, 16], w1: [50, 14] }), b: up(std, { e1: [26, 12], w1: [36, 9] }) },
  upright: { prop: 'plate', a: std, b: up(std, { e1: [26, 14], w1: [34, 18] }) },
  shrug: { prop: 'plate', a: std, b: up(std, { n: [32, 13], e1: [32, 22], w1: [32, 31] }) },
  curl: { prop: 'db', a: up(std, { e1: [32, 25], w1: [33, 35] }), b: up(std, { e1: [32, 25], w1: [38, 17] }) },
  preacher: { scene: 'M34 34 L44 24', prop: 'db', a: up(seat, { e1: [40, 29], w1: [49, 35] }), b: up(seat, { e1: [40, 29], w1: [37, 19] }) },
  pushdown: { prop: 'cable', anchor: [40, -10], a: up(std, { e1: [32, 25], w1: [40, 19] }), b: up(std, { e1: [32, 25], w1: [35, 35] }) },
  ohext: { prop: 'db', a: up(std, { e1: [34, 5], w1: [27, 12] }), b: up(std, { e1: [34, 5], w1: [35, -5] }) },
  skull: { scene: 'M6 40 L42 40 M14 40 L14 56 M36 40 L36 56', prop: 'plate', a: up(lie, { e1: [20, 26], w1: [12, 28] }), b: up(lie, { e1: [20, 26], w1: [21, 16] }) },
  wrist: { prop: 'db', a: up(seat, { h: [34, 21], n: [32, 26], e1: [34, 35], w1: [43, 38] }), b: up(seat, { h: [34, 21], n: [32, 26], e1: [34, 35], w1: [43, 34] }) },
  lunge: { prop: 'db', a: { h: [30, 10], n: [30, 15], e1: [30, 24], w1: [30, 33], p: [30, 34], k1: [38, 44], f1: [41, 56], k2: [24, 45], f2: [18, 56] }, b: { h: [30, 19], n: [30, 24], e1: [30, 33], w1: [30, 42], p: [30, 43], k1: [41, 44], f1: [42, 56], k2: [26, 54], f2: [16, 56] } },
  split: { scene: 'M8 44 L20 44 M10 44 L10 56', prop: 'db', a: { h: [34, 10], n: [34, 15], e1: [34, 24], w1: [34, 33], p: [34, 34], k1: [42, 44], f1: [44, 56], k2: [26, 42], f2: [14, 44] }, b: { h: [34, 19], n: [34, 24], e1: [34, 33], w1: [34, 42], p: [33, 43], k1: [45, 44], f1: [45, 56], k2: [28, 52], f2: [14, 44] } },
  legext: { scene: 'M20 42 L34 42 M22 42 L20 18', prop: 'pad', a: up(seat, { e1: [30, 32], w1: [32, 40] }), b: up(seat, { e1: [30, 32], w1: [32, 40], f1: [53, 40] }) },
  legcurl: { scene: 'M8 42 L50 42', prop: 'pad', a: { h: [10, 37], n: [15, 39], e1: [17, 47], w1: [12, 42], p: [34, 40], k1: [46, 40], f1: [58, 41] }, b: { h: [10, 37], n: [15, 39], e1: [17, 47], w1: [12, 42], p: [34, 40], k1: [46, 40], f1: [49, 28] } },
  seatcurl: { scene: 'M20 42 L34 42 M22 42 L20 18', prop: 'pad', a: up(seat, { e1: [30, 32], w1: [32, 40], f1: [53, 40] }), b: up(seat, { e1: [30, 32], w1: [32, 40], f1: [38, 54] }) },
  calf: { prop: 'db', a: std, b: { h: [32, 7], n: [32, 12], e1: [32, 21], w1: [32, 30], p: [32, 31], k1: [33, 42], f1: [32, 53] } },
  seatcalf: { scene: 'M34 38 L46 38', a: up(seat, { k1: [40, 40], f1: [41, 54], e1: [34, 30], w1: [38, 38] }), b: up(seat, { k1: [40, 37], f1: [41, 51], e1: [34, 28], w1: [38, 36] }) },
  adduct: { front: true, scene: 'M22 42 L42 42', a: { h: [32, 18], n: [32, 23], e1: [26, 31], w1: [24, 40], e2: [38, 31], w2: [40, 40], p: [32, 42], k1: [20, 46], f1: [18, 56], k2: [44, 46], f2: [46, 56] }, b: { h: [32, 18], n: [32, 23], e1: [26, 31], w1: [24, 40], e2: [38, 31], w2: [40, 40], p: [32, 42], k1: [28, 49], f1: [29, 58], k2: [36, 49], f2: [35, 58] } },
  plank: { a: { h: [52, 40], n: [47, 42], e1: [46, 52], w1: [54, 56], p: [28, 46], k1: [18, 50], f1: [8, 54] }, b: { h: [52, 40], n: [47, 42], e1: [46, 52], w1: [54, 56], p: [28, 44], k1: [18, 49], f1: [8, 54] } },
  legraise: { scene: 'M20 -4 L46 -4', a: { h: [32, 10], n: [32, 15], e1: [33, 6], w1: [33, -4], p: [32, 34], k1: [32, 45], f1: [32, 56] }, b: { h: [30, 10], n: [31, 15], e1: [33, 6], w1: [33, -4], p: [30, 34], k1: [42, 32], f1: [52, 28] } },
  crunch: { prop: 'cable', anchor: [38, -10], a: { h: [36, 20], n: [34, 25], e1: [40, 31], w1: [37, 21], p: [30, 42], k1: [30, 56], f1: [18, 56] }, b: { h: [47, 36], n: [43, 36], e1: [44, 43], w1: [46, 35], p: [30, 44], k1: [30, 56], f1: [18, 56] } },
  abwheel: { prop: 'wheel', a: { h: [44, 38], n: [40, 41], e1: [41, 48], w1: [42, 55], p: [26, 44], k1: [24, 56], f1: [12, 56] }, b: { h: [52, 43], n: [47, 45], e1: [52, 50], w1: [58, 55], p: [34, 49], k1: [24, 56], f1: [12, 56] } },
  carry: { prop: 'db', a: up(std, { k1: [36, 45], f1: [39, 56], k2: [29, 45], f2: [25, 56] }), b: up(std, { k1: [29, 45], f1: [25, 56], k2: [36, 45], f2: [39, 56] }) }
};

export const PATTERN_OF = {
  'bench-press': 'bench', 'close-grip-bench-press': 'bench', 'dumbbell-bench-press': 'bench', 'incline-bench-press': 'incline', 'incline-dumbbell-press': 'incline',
  'dumbbell-fly': 'fly', 'cable-crossover': 'crossover', 'machine-chest-press': 'chestpress', 'pec-deck': 'chestpress', 'push-up': 'pushup', dip: 'dip',
  deadlift: 'deadlift', 'sumo-deadlift': 'deadlift', 'trap-bar-deadlift': 'deadlift', 'romanian-deadlift': 'rdl', 'barbell-row': 'row', 'pendlay-row': 'row',
  'dumbbell-row': 'row', 't-bar-row': 'row', 'seated-cable-row': 'cablerow', 'pull-up': 'pullup', 'chin-up': 'pullup', 'lat-pulldown': 'pulldown',
  'straight-arm-pulldown': 'straightarm', 'back-extension': 'backext', 'overhead-press': 'ohp', 'dumbbell-shoulder-press': 'ohp', 'arnold-press': 'ohp',
  'push-press': 'ohp', 'lateral-raise': 'raise', 'cable-lateral-raise': 'raise', 'rear-delt-fly': 'reardelt', 'face-pull': 'facepull', 'upright-row': 'upright',
  'barbell-shrug': 'shrug', 'dumbbell-shrug': 'shrug', 'barbell-curl': 'curl', 'dumbbell-curl': 'curl', 'hammer-curl': 'curl', 'ez-bar-curl': 'curl',
  'cable-curl': 'curl', 'preacher-curl': 'preacher', 'triceps-pushdown': 'pushdown', 'overhead-triceps-extension': 'ohext', 'skull-crusher': 'skull',
  'wrist-curl': 'wrist', 'back-squat': 'squat', 'front-squat': 'squat', 'hack-squat': 'squat', 'goblet-squat': 'goblet', 'leg-press': 'legpress',
  'bulgarian-split-squat': 'split', 'walking-lunge': 'lunge', 'leg-extension': 'legext', 'lying-leg-curl': 'legcurl', 'seated-leg-curl': 'seatcurl',
  'hip-thrust': 'hipthrust', 'standing-calf-raise': 'calf', 'seated-calf-raise': 'seatcalf', 'hip-adduction': 'adduct', 'hip-abduction': 'adduct',
  plank: 'plank', 'hanging-leg-raise': 'legraise', 'cable-crunch': 'crunch', 'ab-wheel': 'abwheel', 'kettlebell-swing': 'swing', 'farmers-walk': 'carry', 'power-clean': 'clean'
};
// Custom exercises: a movement from the muscle they train.
const BY_MUSCLE = { chest: 'bench', back: 'row', shoulders: 'ohp', biceps: 'curl', triceps: 'pushdown', forearms: 'wrist', quads: 'squat', hamstrings: 'rdl', glutes: 'hipthrust', adductors: 'adduct', calves: 'calf', core: 'plank', traps: 'shrug' };
export const patternFor = ex => PATTERN_OF[ex?.id] || BY_MUSCLE[ex?.muscles?.[0]] || 'squat';

const f = v => (Math.round(v * 10) / 10).toString();
const pt = q => `${f(q[0])} ${f(q[1])}`;

// All joints filled in: the far arm/leg follows the near one, a touch behind (side view).
function full(pose, front) {
  const q = { ...pose };
  const off = front ? 0 : -1.6;
  for (const [a, b] of [['e2', 'e1'], ['w2', 'w1'], ['k2', 'k1'], ['f2', 'f1']]) if (!q[a]) q[a] = [q[b][0] + off, q[b][1]];
  for (const k of J) if (!q[k]) throw new Error('pose is missing ' + k);
  return q;
}

// Paths for one pose. Every pose of a pattern gives paths with the same commands, so they morph.
export function posePaths(pattern, which = 'a') {
  const P = PATTERNS[pattern];
  const q = full(P[which], P.front);
  const r = 4.2, [hx, hy] = q.h;
  const out = {
    far: `M${pt(q.n)} L${pt(q.e2)} L${pt(q.w2)} M${pt(q.p)} L${pt(q.k2)} L${pt(q.f2)}`,
    near: `M${pt(q.n)} L${pt(q.p)} M${pt(q.n)} L${pt(q.e1)} L${pt(q.w1)} M${pt(q.p)} L${pt(q.k1)} L${pt(q.f1)}`,
    head: `M${f(hx - r)} ${f(hy)} A${r} ${r} 0 1 0 ${f(hx + r)} ${f(hy)} A${r} ${r} 0 1 0 ${f(hx - r)} ${f(hy)}`,
    prop: ''
  };
  const w = q.w1, circle = (c, rr) => `M${f(c[0] - rr)} ${f(c[1])} A${rr} ${rr} 0 1 0 ${f(c[0] + rr)} ${f(c[1])} A${rr} ${rr} 0 1 0 ${f(c[0] - rr)} ${f(c[1])}`;
  if (P.prop === 'plate') out.prop = circle(w, 4.6);
  else if (P.prop === 'db') out.prop = circle(w, 2.4);
  else if (P.prop === 'kb') out.prop = circle([w[0], w[1] + 3.5], 3.2);
  else if (P.prop === 'wheel') out.prop = circle([w[0], w[1] - 3], 3);
  else if (P.prop === 'pad') out.prop = circle(q.f1, 2.2);
  else if (P.prop === 'sled') out.prop = `M${f(q.f1[0] + 1)} ${f(q.f1[1] - 8)} L${f(q.f1[0] + 5)} ${f(q.f1[1] + 6)}`;
  else if (P.prop === 'cable') out.prop = `M${pt(w)} L${pt(P.anchor)}`;
  return out;
}
