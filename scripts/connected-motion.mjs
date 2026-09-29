// Reversal, explicit compact review, stale permission cleanup, and small-phone access.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { serve, launch, newPage, onScreen, settle } from './lib/harness.mjs';
import { mockServices, STAND_IN } from './lib/voiceflow.mjs';
import { installProbe, frames, mark, judge } from './lib/choreo.mjs';

const server=await serve(), base=`http://127.0.0.1:${server.address().port}/`, browser=await launch();
const out=process.env.EVIDENCE || '/tmp/setline-evidence'; await mkdir(out,{recursive:true});
try {
  for(const reduced of [false,true]) for(const width of [390,320]) {
    const {context,page,errors}=await newPage(browser,base,{reducedMotion:reduced?'reduce':'no-preference'});
    await page.setViewportSize({width,height:844}); await mockServices(page,{delay:200});
    await page.addInitScript(k=>localStorage.setItem('setline.keys',JSON.stringify(k)),STAND_IN);
    await page.goto(base+'?seed=1'); await onScreen(page,'today');
    await page.evaluate(async()=>{const s=await import('./js/store.js'); s.setSettings({spoken:'off',weeklyCheckin:false,accent:'sunset'}); s.addChat('user','How was last week?');s.addChat('model','Four sessions. Keep your plan steady this week.');});
    await settle(page,800); await installProbe(page);
    const origin=await page.locator('#dock .orbbtn').boundingBox(), x=origin.x+origin.width/2,y=origin.y+origin.height/2;
    await mark(page,'reversal');
    await page.mouse.move(x,y); await page.mouse.down();await page.mouse.up();await onScreen(page,'coach');
    await settle(page,90);await page.goBack();await onScreen(page,'today'); await settle(page,800);
    await mark(page,'reversed');
    const sampled=await frames(page,'reversal','reversed');
    assert.deepEqual(judge(sampled,null,{flow:'reversal',reduced}),[]);
    assert.equal(await page.locator('.cm-skin,.cm-orb').count(),0,'transient material remains after reversal');
    await page.mouse.move(x,y);await page.mouse.down();await page.waitForSelector('#ofloat[data-phase=listening]');await settle(page,600);await page.mouse.up();
    await page.waitForSelector('#ofloat.reviewing #vrtext:not(:empty)');
    assert.equal(await page.evaluate(async()=>(await import('./js/store.js')).state.chat.filter(m=>m.role==='user').length),1,'sent before review');
    await page.locator('#vrtext').fill('How can I improve my bench?');
    await page.evaluate(()=>document.getElementById('app')._setKb(340)); await settle(page,350);
    const send=await page.locator('#ofloat .vrsend').boundingBox();
    assert.ok(send.y>=0 && send.y+send.height<=844-340,'review Send is covered by the keyboard');
    await page.evaluate(()=>document.getElementById('app')._setKb(0));
    await settle(page,350);
    await page.screenshot({path:`${out}/review-${width}-${reduced?'reduced':'motion'}.png`});
    await page.evaluate(()=>{const b=document.querySelector('#ofloat .vrsend');b.click();b.click();});
    await onScreen(page,'coach');await settle(page,1000);
    const users=await page.evaluate(async()=>(await import('./js/store.js')).state.chat.filter(m=>m.role==='user').map(m=>m.text));
    assert.equal(users.length,2,'duplicate send');assert.equal(users.at(-1),'How can I improve my bench?');
    await page.screenshot({path:`${out}/coach-${width}-${reduced?'reduced':'motion'}.png`});
    await page.goBack();await onScreen(page,'today');await settle(page,700);
    await page.locator('#dock .orbbtn').focus();await page.keyboard.press('Enter');await onScreen(page,'coach');
    assert.deepEqual(errors,[]);console.log(`✓ ${width}px ${reduced?'reduced':'motion'}: reversal, edited review, one send, keyboard access`);
    await context.close();
  }
  const {context,page,errors}=await newPage(browser,base); await mockServices(page);
  await page.addInitScript(k=>{localStorage.setItem('setline.keys',JSON.stringify(k));const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async opts=>{await new Promise(r=>setTimeout(r,600));const stream=await get(opts);window.__lateStream=stream;return stream;};},STAND_IN);
  await page.goto(base+'?seed=1');await onScreen(page,'today');await settle(page,800);
  const o=await page.locator('#dock .orbbtn').boundingBox();await page.mouse.move(o.x+o.width/2,o.y+o.height/2);await page.mouse.down();await page.waitForSelector('#ofloat[data-phase=opening]');
  await page.dispatchEvent('#dock .orbbtn','pointercancel',{pointerId:1});await page.mouse.up();await settle(page,1200);
  assert.equal(await page.evaluate(async()=>(await import('./js/voice.js')).isRecording()),false);
  assert.ok(await page.evaluate(()=>window.__lateStream?.getTracks().every(t=>t.readyState==='ended')),'late stream was not released');
  assert.equal(await page.locator('#ofloat:not([hidden])').count(),0);assert.deepEqual(errors,[]);
  console.log('✓ pointer cancellation while permission is pending releases the late stream');await context.close();
  const cancelled=await newPage(browser,base); await mockServices(cancelled.page);
  await cancelled.page.addInitScript(k=>localStorage.setItem('setline.keys',JSON.stringify(k)),STAND_IN);
  await cancelled.page.route(/generativelanguage\.googleapis\.com.*:generateContent/,async route=>{
    await new Promise(r=>setTimeout(r,1800));
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({type:'question'})}]}}]})}).catch(()=>{});
  });
  await cancelled.page.goto(base+'?seed=1');await onScreen(cancelled.page,'today');await settle(cancelled.page,800);
  await cancelled.page.evaluate(async()=>{const voice=await import('./js/ui/voice.js');voice.openVoice();voice.handleText('kumquat quantum salutation',{typed:true});});
  await cancelled.page.waitForSelector('#intent.show[data-kind=wait]');
  await cancelled.page.evaluate(async()=>{await (await import('./js/ui/voice.js')).closeVoice();});
  assert.equal(await cancelled.page.locator('#intent.show[data-kind=wait]').count(),0,'cancelled classification left a waiting card');
  await settle(cancelled.page,2200);
  assert.equal(await cancelled.page.locator('#s-coach.screen.on,#voice:not([hidden]),#intent.show[data-kind=wait]').count(),0,'late classification reopened a cancelled session');
  assert.deepEqual(cancelled.errors,[]);console.log('✓ cancellation clears its waiting card and ignores the late classification');await cancelled.context.close();
} finally {await browser.close();server.close();}
