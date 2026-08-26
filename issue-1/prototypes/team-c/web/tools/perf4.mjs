import { chromium } from 'playwright';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await b.newPage({viewport:{width:1600,height:950}, deviceScaleFactor:1});
await p.goto('http://127.0.0.1:8853',{waitUntil:'domcontentloaded'});
await p.waitForFunction(()=>window.__app&&window.__app.ready());
console.log('webgl', JSON.stringify(await p.evaluate(()=>{
  const c=document.createElement('canvas'); const gl=c.getContext('webgl2')||c.getContext('webgl');
  const d=gl.getExtension('WEBGL_debug_renderer_info');
  return {vendor: gl.getParameter(d?d.UNMASKED_VENDOR_WEBGL:gl.VENDOR), renderer: gl.getParameter(d?d.UNMASKED_RENDERER_WEBGL:gl.RENDERER)};
})));
for (const n of [500,2000]) {
  await p.evaluate(k=>window.__app.actions.loadSynthetic(k), n);
  await p.waitForFunction(()=>document.getElementById('toast').classList.contains('hidden'),null,{timeout:120000});
  await p.waitForTimeout(700);
  const st=await p.evaluate(()=>({nodes:window.__app.state.graph.order,edges:window.__app.state.graph.size,collapsed:window.__app.state.collapsed.size,drawn:window.__app.counts().drawn,collapseMs:window.__app.state.perf.lastCollapseMs}));
  console.log(n,'after load (semantic zoom active):',JSON.stringify(st), JSON.stringify(await p.evaluate(()=>window.__app.benchmark(2000))));
  await p.evaluate(()=>{window.__app.state.semanticZoom=false; window.__app.actions.expandAll();});
  await p.waitForTimeout(400);
  console.log(n,'fully expanded            :',JSON.stringify(await p.evaluate(()=>({nodes:window.__app.state.graph.order,edges:window.__app.state.graph.size,drawn:window.__app.counts().drawn}))), JSON.stringify(await p.evaluate(()=>window.__app.benchmark(2000))));
}
await b.close();
