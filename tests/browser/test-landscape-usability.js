// Requires a running app; uses an isolated mount without modifying presentation data.
const { chromium } = require('playwright');
(async () => {
 const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
 try {
 const page=await browser.newPage();
 await page.goto(process.env.SLIDEFORGE_TEST_URL || 'http://127.0.0.1:8076/',{waitUntil:'networkidle'});
 const result=await page.evaluate(async()=>{
  const plugin=getSlidePlugin('landscape'), data=plugin.normalize({...plugin.defaultData,view:'surface',resolution:17});
  const context=_pluginRenderContext(plugin,{width:'640px',height:'420px'});
  await plugin.render(data,context);
  const host=document.createElement('div');host.className='plugin-live-view';host.style.cssText='position:fixed;z-index:2147483647;width:640px;height:420px;top:0;left:0';document.body.append(host);
  // The explorer saves the view itself once it settles: every update lands here.
  let saved=null;const controller=new AbortController();
  const dispose=SlideForgeLandscape.mount(host,data,{...context,signal:controller.signal,update:v=>{saved={...saved,...v}}});
  const canvas=host.querySelector('canvas');
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const check=(v,m)=>{if(!v)throw Error(m)};
  check(getComputedStyle(canvas).cursor==='grab','orbit cursor');
  check(getComputedStyle(host.querySelector('.landscape-toolbar')).opacity==='1','controls visible');
  check(!host.querySelector('[aria-label="Use view for export"],[aria-label="Rotation axis"]'),'removed controls still shown');
  // Toolbar stays one compact row: speed only while rotating, optional controls shed in narrow boxes.
  const toolbar=host.querySelector('.landscape-toolbar'),shown=s=>getComputedStyle(s).display!=='none';
  check(!shown(host.querySelector('[aria-label="Auto rotation speed"]')),'speed shown while not rotating');
  host.style.width='420px';await new Promise(r=>requestAnimationFrame(r));
  check(![...toolbar.querySelectorAll('select,.landscape-zoom,.landscape-fit')].some(shown),'narrow box keeps optional controls');
  check(toolbar.offsetHeight<=40&&toolbar.offsetWidth<=260,'narrow toolbar wraps or crowds the title '+toolbar.offsetWidth);
  host.style.width='640px';
  canvas.dispatchEvent(new WheelEvent('wheel',{deltaY:0,deltaX:100,cancelable:true}));await wait(450);check(saved===null,'horizontal wheel changed zoom');
  canvas.dispatchEvent(new WheelEvent('wheel',{deltaY:1,cancelable:true}));await wait(450);check(saved.zoom<1&&saved.zoom>=0.99,'small wheel too abrupt');
  canvas.dispatchEvent(new WheelEvent('wheel',{deltaY:100,cancelable:true}));await wait(450);check(saved.zoom<0.9,'large wheel not proportional');
  // Straight-on views look along an axis; 3D goes back to the angled view.
  for(const [name,yaw,pitch] of [['Top',0,90],['Front',0,0],['Side',-90,0],['3D',-35,40]]){
   const b=[...host.querySelectorAll('.landscape-view-button')].find(b=>b.textContent===name);b.click();await wait(700);
   check(saved.yaw===yaw&&saved.pitch===pitch&&saved.zoom===1&&saved.panX===0,name+' view '+JSON.stringify(saved));
   check(b.getAttribute('aria-pressed')==='true',name+' not marked current');
  }
  window.usability={host,canvas,getSaved:()=>saved,dispose,controller};
  return {wheel:'passed',controls:'visible',cursor:'grab',views:'Top/Front/Side/3D'};
 });
 const canvas=page.locator('.landscape-canvas'); const box=await canvas.boundingBox();
 await page.mouse.move(box.x+250,box.y+200);await page.mouse.down();
 if(await canvas.evaluate(c=>getComputedStyle(c).cursor)!=='grabbing')throw Error('drag cursor');
 await page.mouse.move(box.x+300,box.y+220,{steps:4});await page.mouse.up();
 await page.waitForTimeout(500);
 await page.evaluate(()=>{if(usability.getSaved().yaw===-35)throw Error('orbit was not saved')});
 // Synthetic touch events with capture stub to exercise multi-pointer transitions.
 await page.evaluate(async()=>{
 const {canvas,getSaved}=usability;canvas.setPointerCapture=()=>{};
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const fire=(type,id,x,y)=>canvas.dispatchEvent(new PointerEvent(type,{pointerId:id,pointerType:'touch',button:0,clientX:x,clientY:y}));
 fire('pointerdown',101,200,200);fire('pointerdown',102,300,200);
 fire('pointermove',102,320,200);fire('pointerup',102,320,200);await wait(450);const before=getSaved().yaw;
 fire('pointermove',101,230,200);fire('pointerup',101,230,200);await wait(450);if(getSaved().yaw===before)throw Error('remaining finger cannot rotate');
 const speed=usability.host.querySelector('[aria-label="Auto rotation speed"]');
 usability.host.querySelector('[aria-label="Start auto rotation"]').click();await wait(50);
 if(getComputedStyle(speed).display==='none')throw Error('speed hidden while rotating');
 speed.value="45";speed.dispatchEvent(new Event("change"));await wait(50);
 const preferences={...getSaved()};
 if(preferences.autoRotate!==true||preferences.rotationSpeed!==45)throw Error("playback preferences not saved automatically");
 const api=SlideForgeLandscape,plugin=getSlidePlugin("landscape");
 const yawNow=()=>{const s=usability.canvas;return s.toDataURL()};
 await wait(200);const moving=yawNow();
 fire('pointerdown',301,200,200);await wait(150);const held=yawNow();await wait(150);
 if(yawNow()!==held)throw Error("rotation did not pause during drag");
 fire('pointerup',301,200,200);await wait(150);
 if(yawNow()===held)throw Error("rotation did not resume");
 const showData=plugin.normalize({...plugin.defaultData,...getSaved(),...preferences,view:"surface",resolution:17});
 usability.controller.abort();usability.dispose();
 let showSaved=false;const context=_pluginRenderContext(plugin,{width:"640px",height:"420px"}), showController=new AbortController();
 const showDispose=api.mount(usability.host,showData,{...context,isPresenting:true,signal:showController.signal,update:()=>{showSaved=true}});
 const showCanvas=usability.host.querySelector("canvas");
 if(!usability.host.querySelector('[aria-label="Pause auto rotation"]'))throw Error("presentation did not start rotating");
 if(usability.host.querySelector('[aria-label="Crop box to content"]'))throw Error("editor controls in show");
 const still=showCanvas.toDataURL();await wait(250);
 if(showCanvas.toDataURL()===still)throw Error("presentation surface is stationary");
 usability.host.querySelector('[aria-label="Pause auto rotation"]').click();
 await wait(50);const paused=showCanvas.toDataURL();await wait(150);
 if(showCanvas.toDataURL()!==paused)throw Error("presentation pause failed");
 // Orbiting in the show is temporary: nothing is saved.
 const sc=showCanvas;sc.setPointerCapture=()=>{};
 sc.dispatchEvent(new PointerEvent('pointerdown',{pointerId:401,pointerType:'mouse',button:0,clientX:200,clientY:200}));
 sc.dispatchEvent(new PointerEvent('pointermove',{pointerId:401,pointerType:'mouse',button:0,clientX:260,clientY:200}));
 sc.dispatchEvent(new PointerEvent('pointerup',{pointerId:401,pointerType:'mouse',button:0,clientX:260,clientY:200}));
 await wait(500);if(showSaved)throw Error("show changed saved settings");
 showController.abort();showDispose();usability.host.remove();
 });
 console.log('PASS',result,'mouse orbit auto-saved, touch continuation, auto rotation, pause/resume, persistence, show never saves');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
