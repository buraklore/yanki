function __audit(){
  const R={overflowX:document.documentElement.scrollWidth-window.innerWidth,
    dupIds:[],tiny:[],smallTap:[],lowContrast:[],overflowEls:[],emptyLinks:[],noLabel:[]};
  const seen={};document.querySelectorAll('[id]').forEach(e=>{seen[e.id]=(seen[e.id]||0)+1});
  for(const k in seen) if(seen[k]>1) R.dupIds.push(k+' x'+seen[k]);
  const parse=c=>{const m=(c||'').match(/[\d.]+/g); if(!m) return null;
    return {r:+m[0],g:+m[1],b:+m[2],a:m[3]!==undefined?+m[3]:1};};
  const over=(f,b)=>({r:f.r*f.a+b.r*(1-f.a),g:f.g*f.a+b.g*(1-f.a),b:f.b*f.a+b.b*(1-f.a),a:1});
  const lum=o=>{const g=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};
    return 0.2126*g(o.r)+0.7152*g(o.g)+0.0722*g(o.b);};
  const effBg=e=>{const st=[];let n=e;
    while(n&&n!==document.documentElement){const c=parse(getComputedStyle(n).backgroundColor);
      if(c&&c.a>0){st.push(c); if(c.a===1) break;} n=n.parentElement;}
    let base={r:10,g:11,b:15,a:1};
    for(let i=st.length-1;i>=0;i--) base=over(st[i],base);
    return base;};
  document.querySelectorAll('*').forEach(e=>{
    const cs=getComputedStyle(e), r=e.getBoundingClientRect();
    if(r.width===0&&r.height===0) return;
    const txt=[...e.childNodes].filter(n=>n.nodeType===3&&n.textContent.trim())
      .map(n=>n.textContent.trim()).join(' ');
    if(txt){
      const fsz=parseFloat(cs.fontSize);
      if(fsz<10) R.tiny.push(fsz.toFixed(1)+'px "'+txt.slice(0,42)+'"');
      const fill=cs.webkitTextFillColor||cs.color;
      const fgc=parse(fill);
      if(fgc&&fgc.a>0.05){
        const bg=effBg(e), fg=over(fgc,bg);
        const ratio=(Math.max(lum(fg),lum(bg))+0.05)/(Math.min(lum(fg),lum(bg))+0.05);
        const big=fsz>=24||(fsz>=18.66&&parseInt(cs.fontWeight)>=700);
        if(ratio<(big?3:4.5)) R.lowContrast.push(ratio.toFixed(2)+':1 '+fsz.toFixed(0)+'px "'+txt.slice(0,42)+'"');
      }
    }
    if(/^(BUTTON|A|SUMMARY)$/.test(e.tagName)&&r.width>0&&e.offsetParent!==null){
      if(r.height<28) R.smallTap.push(e.tagName+' '+Math.round(r.height)+'px "'+(e.textContent||'').trim().slice(0,30)+'"');
      if(e.tagName==='A'&&!(e.textContent||'').trim()&&!e.querySelector('img,svg')) R.emptyLinks.push(e.outerHTML.slice(0,70));
    }
    if(/^(INPUT|SELECT|TEXTAREA)$/.test(e.tagName)){
      const lab=e.id&&document.querySelector('label[for="'+e.id+'"]');
      if(!lab&&!e.closest('label')&&!e.getAttribute('aria-label')&&!e.getAttribute('placeholder'))
        R.noLabel.push(e.id||e.name||e.type);
    }
    if(e.scrollWidth>e.clientWidth+2&&cs.overflowX==='visible'&&e.clientWidth>0&&e.tagName!=='HTML'&&!(e instanceof SVGElement))
      R.overflowEls.push(String(e.className||e.tagName).slice(0,46)+' +'+(e.scrollWidth-e.clientWidth)+'px');
  });
  const u=a=>[...new Set(a)];
  R.tiny=u(R.tiny).slice(0,14); R.lowContrast=u(R.lowContrast).slice(0,16);
  R.smallTap=u(R.smallTap).slice(0,10); R.overflowEls=u(R.overflowEls).slice(0,10);
  return R;
};
