import { chromium } from 'playwright';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
for (const dpr of [1,2]) {
  const p=await b.newPage({viewport:{width:1600,height:950}, deviceScaleFactor:dpr});
  await p.goto('http://127.0.0.1:8853',{waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>window.__app&&window.__app.ready());
  await p.evaluate(()=>window.__app.actions.loadScenario('s2-babs-ria'));
  await p.waitForTimeout(500);
  await p.evaluate(()=>window.__app.actions.expandNode('d:super','*'));
  await p.waitForTimeout(3000);
  await p.evaluate(()=>{window.__app.state.semanticZoom=false;});
  const a=await p.evaluate(()=>window.__app.benchmark(2000));
  await p.evaluate(()=>{ window.__r=null; });
  const noEL=await p.evaluate(async()=>{ window.__app.state.hulls=false; window.__noOverlay=true; return null; });
  const c=await p.evaluate(()=>window.__app.benchmark(2000));
  console.log('dpr',dpr,'full',JSON.stringify(a),'| no overlay/hulls',JSON.stringify(c));
  await p.close();
}
await b.close();
