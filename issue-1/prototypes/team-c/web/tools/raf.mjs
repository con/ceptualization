import { chromium } from 'playwright';
const measure = async (args, label) => {
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args});
  const p=await b.newPage({viewport:{width:1600,height:950}});
  await p.setContent('<html><body style="background:#111"></body></html>');
  const r=await p.evaluate(()=>new Promise(res=>{
    const t=[]; let last=performance.now(); const s=last;
    function f(n){ t.push(n-last); last=n; if(n-s>1500){ t.sort((a,b)=>a-b); res({n:t.length, median:+t[Math.floor(t.length/2)].toFixed(2)}); return;} requestAnimationFrame(f);} requestAnimationFrame(f);
  }));
  console.log(label, JSON.stringify(r));
  await b.close();
};
await measure([], 'default');
await measure(['--disable-frame-rate-limit','--disable-gpu-vsync'], 'no-vsync');
