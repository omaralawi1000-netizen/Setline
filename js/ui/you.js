// You: everything about you in one calm place: progress, body, history, what the Coach knows,
// settings. The fourth tab, so the orb can sit in the middle of the bar.
import { state } from '../store.js';
import { esc } from './dom.js';
import { I } from './icons.js';
import { bodyTrend } from '../body.js';
import { weight } from '../format.js';
import { ageOf } from '../profile.js';

export function renderYou(root) {
  const { t, lang, settings: s } = state;
  const p = s.profile;
  const bw = bodyTrend(state.bodyweight);
  const tile = (attr, icon, title, sub, i) => `<button class="ytile solid" ${attr} style="--i:${i}"><span class="tic">${icon}</span><span class="l"><strong>${title}</strong><small>${esc(sub)}</small></span>${I.fwd}</button>`;
  const prs = state.history.filter(w => w.startedAt >= Date.now() - 30 * 86_400_000).reduce((a, w) => a + (w.prs?.length || 0), 0);
  root.innerHTML = `<div class="tabtop"></div>
    <div class="hhead"><h1 class="greet tabh">${t('tab.you')}</h1></div>
    <button class="yhero glass" data-act="open-settings">
      <span class="yav">${esc((p?.name || '?').slice(0, 1).toUpperCase())}</span>
      <span class="l"><strong>${esc(p?.name || t('you.noName'))}</strong><small>${esc([p?.birthYear ? t('you.age', { n: ageOf(p) }) : '', bw ? `${weight(bw.latest.kg, s.unit, lang)} ${t('unit.' + s.unit)}` : '', p?.goal ? t('ob.goal.' + p.goal) : ''].filter(Boolean).join(' · ') || t('you.setUp'))}</small></span>${I.fwd}
    </button>
    <div class="ylist">
      ${tile('data-progress', I.chart, t('hub.progress'), t('hub.progressSub', { n: prs }), 0)}
      ${tile('data-bodyscreen', I.ruler, t('bodyx.title'), t('hub.bodySub'), 1)}
      ${tile('data-historyscreen', I.history, t('history.title'), t('hub.historySub', { n: state.history.length }), 2)}
      ${tile('data-act="memory"', I.chat, t('memory.title'), t('memory.sub', { n: (s.memories || []).length }), 3)}
      ${tile('data-act="customize"', I.settings, t('cust.title'), t('look.settingsSub'), 4)}
      ${tile('data-act="open-settings"', I.settings, t('settings.title'), t('you.settingsSub'), 5)}
    </div>`;
}
