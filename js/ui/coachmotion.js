import { onFrame } from './frame.js';
import { handOrb } from './dotorb.js';
import { reduced } from './choreo.js';
import { joinedGlass, mix, smooth, segmentValue } from './motiongeometry.js';

let active = null;
const rect = (el, app) => { const r = el.getBoundingClientRect(), a = app.getBoundingClientRect(); return { x: r.left - a.left, y: r.top - a.top, w: r.width, h: r.height }; };
const duration = (cs, name, fallback) => { const x = cs.getPropertyValue(name).trim(); return parseFloat(x) * (x.endsWith('ms') ? 1 : 1000) || fallback; };

// One presentation owner and one reversible progress value coordinate the material,
// content mask, highlight and orb. Navigation/data are never held until it settles.
export function morphCoach(open, under) {
  if (active) { active.retarget(open); return; }
  const app = document.getElementById('app'), coach = document.getElementById('s-coach');
  const box = document.getElementById('composer'), dock = document.getElementById('dock');
  const dOrb = dock?.querySelector('.orb'), cOrb = box?.querySelector('.corb .orb');
  const bubble = dock?.querySelector('.obub'), cbg = box?.querySelector('.cbg');
  const veil = document.querySelector('.aura .veil'), aura = veil?.parentElement;
  if (!dOrb || !cOrb || !bubble || !cbg || !under) return;
  const other = under === coach ? null : under;
  const cs = getComputedStyle(document.documentElement), calm = reduced();
  app.classList.add('choreo', 'cm-dock', 'cm-box');
  const A = rect(bubble, app), B = rect(box, app), S = rect(dOrb, app), D = rect(cOrb, app);
  const W = app.clientWidth, H = app.clientHeight;
  const size = parseFloat(getComputedStyle(dOrb).getPropertyValue('--s')) || 60;
  const pieces = [...dock.querySelectorAll('.tab,.ind,.dcap,.obub')];
  const fields = [...box.querySelectorAll(':scope > input,:scope > .thinkline')];
  const skin = document.createElement('div'); skin.className = 'cm-skin'; skin.setAttribute('aria-hidden', 'true');
  Object.assign(skin.style, { left: `${B.x}px`, top: `${B.y}px`, width: `${B.w}px`, height: `${B.h}px` });
  const edge = document.createElement('span'); edge.className = 'cm-light'; skin.append(edge);
  const ghost = document.createElement('div'); ghost.className = 'orbghost cm-orb'; ghost.setAttribute('aria-hidden', 'true');
  const orb = document.createElement('span'); orb.className = 'orb'; orb.style.setProperty('--s', `${size}px`); ghost.append(orb);
  Object.assign(ghost.style, { left: `${S.x+S.w/2-size/2}px`, top: `${S.y+S.h/2-size/2}px`, width: `${size}px`, height: `${size}px` });
  app.append(skin, ghost); handOrb(open ? dOrb : cOrb, orb);
  dOrb.style.visibility = cOrb.style.visibility = 'hidden';
  app.classList.add('choreo', 'cm-dock', 'cm-box'); aura?.classList.add('run');
  if (other) other.style.visibility = 'visible'; coach.style.visibility = 'visible';
  cbg.style.visibility = 'hidden';
  for (const x of [ghost, coach, other].filter(Boolean)) x.style.willChange = x === ghost ? 'transform' : 'opacity';
  let p = open ? 0 : 1, from = p, target = +open, start = null;
  let ms = calm ? duration(cs, '--m-fast', 180) : duration(cs, open ? '--m-coach-open' : '--m-coach-close', open ? 400 : 300);
  const clean = () => {
    stop(); active = null;
    const held=[dock,box,coach,other,veil].filter(Boolean);
    for(const x of held) x.style.transition='none';
    handOrb(orb, target ? cOrb : dOrb);
    dOrb.style.visibility = cOrb.style.visibility = ''; cbg.style.visibility = '';
    for (const x of [coach, other, veil, ...pieces, ...fields].filter(Boolean)) {
      x.style.opacity = x.style.transform = x.style.clipPath = x.style.visibility = x.style.willChange = '';
    }
    skin.remove(); ghost.remove();
    app.classList.remove('choreo', 'cm-dock', 'cm-box', 'cm-ready'); aura?.classList.remove('run');
    void dock.offsetWidth;
    requestAnimationFrame(()=>{for(const x of held) x.style.transition='';});
    for (const m of coach.querySelectorAll('.msg')) m.classList.add('seen');
    if (!target && document.activeElement?.closest('#composer,#s-coach')) dock.querySelector('.orbbtn')?.focus({ preventScroll: true });
  };
  const paint = () => {
    const u = calm ? p : smooth(0, 1, p);
    const content = calm ? p : smooth(.32, .85, p);
    // Home has receded before the conversation becomes readable; text never scales.
    if (other) { other.style.opacity = String(1 - smooth(0, .32, p)); other.style.transform = calm ? 'none' : `scale(${mix(1,.985,u)})`; }
    coach.style.opacity = String(content);
    const top = mix(B.y, 0, smooth(.12, .94, p)), left = mix(A.x, 0, u), right = mix(W - A.x - A.w, 0, u);
    const mask = `inset(${top.toFixed(2)}px ${right.toFixed(2)}px ${mix(H-B.y-B.h,0,u).toFixed(2)}px ${left.toFixed(2)}px round ${mix(B.h/2,0,u).toFixed(2)}px)`;
    if (!calm) coach.style.clipPath = mask;
    if (veil) { veil.style.opacity = calm ? String(p) : '1'; veil.style.clipPath = calm ? 'none' : mask; }
    skin.style.clipPath = `path("${joinedGlass(B.w, B.h, B.w - A.w - 12, u)}")`;
    skin.style.opacity = String(calm ? 1 : 1 - smooth(.82,1,p) * .04);
    edge.style.opacity = String(calm ? 0 : Math.sin(Math.PI*p)*.7);
    edge.style.transform = `translateX(${mix(B.w-48,12,u).toFixed(2)}px) scaleX(${mix(.3,1,u).toFixed(3)})`;
    const x = mix(S.x+S.w/2,D.x+D.w/2,u)-(S.x+S.w/2), y = mix(S.y+S.h/2,D.y+D.h/2,u)-(S.y+S.h/2);
    ghost.style.transform = `translate(${x.toFixed(2)}px,${y.toFixed(2)}px) scale(${mix(S.w/size,D.w/size,u).toFixed(4)})`;
    orb.style.scale = calm ? '1' : `${1 - .045*Math.sin(Math.PI*p)} ${1 + .025*Math.sin(Math.PI*p)}`;
    for (const x of pieces) x.style.opacity = x.matches('.dcap,.obub') ? '0' : String(1-smooth(0,.24,p));
    for (const x of fields) x.style.opacity = String(content);
    app.classList.toggle('cm-ready', p > .72);
  };
  active = { retarget(on) { from = p; target = +on; start = null; ms = (calm ? duration(cs,'--m-fast',180) : duration(cs,on ? '--m-coach-open':'--m-coach-close',on ? 400:300)) * Math.max(.18,Math.abs(target-from)); }, finish: clean };
  paint();
  const stop = onFrame(now => {
    start ??= now;
    p = segmentValue(from,target,now-start,ms); paint();
    if (now-start >= ms) clean();
  });
}

export function settleCoachMotion() { active?.finish(); }
