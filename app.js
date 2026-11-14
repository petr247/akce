'use strict';
const KEY = window.MAPY_KEY || '';
const API = 'https://api.mapy.com/v1';
const TYPES = {
  trh:{n:'Trhy a jarmarky', c:'var(--m-red)'},
  hrad:{n:'Památky a prohlídky', c:'var(--m-blue)'},
  kultura:{n:'Kultura', c:'var(--m-violet)'},
  gastro:{n:'Gastro', c:'var(--m-yellow)'},
  sport:{n:'Sport', c:'var(--m-teal)'},
  priroda:{n:'Příroda', c:'var(--m-green)'}
};
const MODES = {
  walk:{n:'Pěšky', rt:'foot_fast', opts:[['5','5 km'],['10','10 km'],['x','Vše']]},
  bike:{n:'Na kole', rt:'bike_road', opts:[['15','15 min'],['30','30 min'],['60','60 min'],['x','Vše']]},
  auto:{n:'Autem', rt:'car_fast', opts:[['15','15 min'],['30','30 min'],['45','45 min'],['x','Vše']]}
};
const TIMES = [['now','Teď a brzy'],['today','Dnes'],['tomorrow','Zítra'],['weekend','Víkend'],['14','14 dní'],['all','Vše']];
const ZONES = [['here','Přímo tady',1.5],['near','Blízké okolí',12],['far','Širší okolí',1e9]];

let ORIGINS = [], P = {}, EVENTS = [];
const st = {origin:null, time:'14', mode:'auto', reach:'x', types:new Set(), free:false, kids:false, place:null, open:new Set()};
const routes = {}; // "lat,lon|mode" -> {placeId:{km,min}}

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const say = t => { $('msg').textContent = t || ''; };

// ---------- geo ----------
const km = (a,b) => { const R=6371, r=x=>x*Math.PI/180, dl=r(b.lat-a.lat), dn=r(b.lon-a.lon);
  const h=Math.sin(dl/2)**2+Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dn/2)**2; return 2*R*Math.asin(Math.sqrt(h)); };
const rkey = () => st.origin.lat.toFixed(4)+','+st.origin.lon.toFixed(4)+'|'+st.mode;
function estimate(p){ const road=km(st.origin,p)*1.3, m=st.mode;
  return {km:road, min: m==='walk'? road/4.5*60 : m==='bike'? road/15*60 : road/50*60+2, est:true}; }
function travel(pid){ const r=routes[rkey()]; return (r && r[pid]) || estimate(P[pid]); }
function reachOk(tr){ if(st.reach==='x') return true; const v=+st.reach; return st.mode==='walk'? tr.km<=v : tr.min<=v; }
const fmtKm = k => k<1 ? Math.max(100,Math.round(k*10)*100)+' m' : (k<10? k.toFixed(1).replace('.',',') : Math.round(k))+' km';
const fmtMin = m => m<60 ? Math.max(1,Math.round(m))+' min' : Math.floor(m/60)+' h '+String(Math.round(m%60)).padStart(2,'0')+' min';
function travelLabel(tr){
  if(tr.km<0.4) return 'jsi na místě';
  return (tr.est?'≈ ':'')+fmtKm(tr.km)+' · '+fmtMin(tr.min)+' '+({walk:'pěšky',bike:'na kole',auto:'autem'}[st.mode]);
}
async function loadRoutes(){
  const k=rkey(); if(routes[k] || !KEY) return;
  const ids=Object.keys(P); if(!ids.length || ids.length>100) return;
  const url=API+'/routing/matrix-m?apikey='+encodeURIComponent(KEY)+'&routeType='+MODES[st.mode].rt
    +'&starts='+st.origin.lon+','+st.origin.lat+'&ends='+ids.map(i=>P[i].lon+','+P[i].lat).join(';');
  try{
    const r=await fetch(url); if(!r.ok) throw new Error('HTTP '+r.status);
    const row=(await r.json()).matrix[0], out={};
    ids.forEach((id,i)=>{ const c=row[i]; if(c && c.length>=0 && c.duration>=0) out[id]={km:c.length/1000, min:c.duration/60}; });
    routes[k]=out; if(k===rkey()) render();
  }catch(e){ routes[k]={}; console.warn('Trasy Mapy.com nedostupné, používám odhad:', e.message); }
}

// ---------- time ----------
const day0 = d => new Date(d.getFullYear(),d.getMonth(),d.getDate());
const addD = (d,n) => new Date(d.getFullYear(),d.getMonth(),d.getDate()+n);
function windowFor(key,now){
  const t=day0(now);
  if(key==='now') return [now,new Date(now.getTime()+3*3600e3)];
  if(key==='today') return [now,addD(t,1)];
  if(key==='tomorrow') return [addD(t,1),addD(t,2)];
  if(key==='weekend'){ const w=t.getDay(); const sat= w===0? addD(t,-1) : addD(t,6-w); return [new Date(Math.max(now,sat)),addD(sat,2)]; }
  if(key==='14') return [now,addD(t,14)];
  return [now,new Date(2100,0,1)];
}
const DS=['ne','po','út','st','čt','pá','so'];
const hm = d => d.getHours()+':'+String(d.getMinutes()).padStart(2,'0');
const dm = d => d.getDate()+'. '+(d.getMonth()+1)+'.';
function dayShort(d,now){ const diff=Math.round((day0(d)-day0(now))/864e5);
  return diff===0?'Dnes':diff===1?'Zítra':DS[d.getDay()]+' '+dm(d); }

// ---------- filter ----------
function rows(now,timeKey=st.time){
  const [a,b]=windowFor(timeKey,now), out=[];
  for(const ev of EVENTS){
    if(st.types.size && !st.types.has(ev.type)) continue;
    if(st.free && ev.price!==0) continue;
    if(st.kids && !ev.tags.includes('děti')) continue;
    const tr=travel(ev.place);
    for(const o of ev.o){
      if(o.e<=now || o.s>=b || o.e<=a) continue;
      const live=o.s<=now;
      out.push({ev,o,p:P[ev.place],tr,live,ok:reachOk(tr),at:live? (ev.allDay? new Date(Math.max(a,now)) : now) : o.s});
      break;
    }
  }
  return out;
}
const zoneOf = r => ZONES.find(z=>r.tr.km<=z[2])[0];
const byTime = r => r.slice().sort((x,y)=>(day0(x.at)-day0(y.at)) || (x.ev.allDay?1:0)-(y.ev.allDay?1:0) || x.at-y.at);

// ---------- render ----------
function btn(label,pressed,on,cls='',extra=''){
  const b=document.createElement('button'); b.type='button'; b.className=cls; b.innerHTML=extra+label;
  b.setAttribute('aria-pressed',pressed); b.onclick=on; return b;
}
function renderControls(now){
  const tr=$('timeRow'); tr.replaceChildren();
  for(const [k,n] of TIMES){ const c=rows(now,k).filter(r=>r.ok).length;
    tr.append(btn(esc(n)+' <small>'+c+'</small>',st.time===k,()=>{st.time=k;render();},'chip time')); }
  const ms=$('modeSeg'); ms.replaceChildren();
  for(const k in MODES) ms.append(btn(MODES[k].n,st.mode===k,()=>{st.mode=k;st.reach=k==='walk'?'10':'x';render(true);loadRoutes();}));
  const rs=$('reachSeg'); rs.replaceChildren();
  for(const [k,n] of MODES[st.mode].opts) rs.append(btn(n,st.reach===k,()=>{st.reach=k;render(true);}));
  const ty=$('typeRow'); ty.replaceChildren();
  for(const k in TYPES) ty.append(btn(TYPES[k].n,st.types.has(k),()=>{st.types.has(k)?st.types.delete(k):st.types.add(k);render();},'chip','<span class="dot" style="background:'+TYPES[k].c+'"></span>'));
  ty.append(btn('Pro děti',st.kids,()=>{st.kids=!st.kids;render();},'chip'));
  ty.append(btn('Zdarma',st.free,()=>{st.free=!st.free;render();},'chip'));
}
const priceText = ev => ev.priceLabel || (ev.price===0?'zdarma':ev.price?ev.price+' Kč':'zdroj cenu neuvádí');
function whenCell(r,now){
  const {ev,o,live}=r;
  if(ev.allDay) return '<span>'+(live?'Probíhá':dayShort(o.s,now))+'</span><b>celý den</b><span>do '+dm(o.e)+'</span>';
  if(live) return '<span>Dnes</span><b>Teď</b><span>do '+hm(o.e)+'</span>';
  return '<span>'+dayShort(o.s,now)+'</span><b>'+hm(o.s)+'</b><span>'+(ev.openEnd?'začátek':'do '+hm(o.e))+'</span>';
}
function dayBar(r){
  if(r.ev.allDay) return '';
  const f=d=>Math.min(100,Math.max(0,((d.getHours()+d.getMinutes()/60)-8)/14*100));
  const a=f(r.o.s), b=r.ev.openEnd? Math.min(100,a+4) : f(r.o.e);
  return '<div class="bar" aria-hidden="true"><i style="left:'+a.toFixed(1)+'%;width:'+Math.max(3,b-a).toFixed(1)+'%;background:'+TYPES[r.ev.type].c+'"></i></div>';
}
function card(r,now){
  const {ev,p,tr,live}=r, id=ev.id, T=TYPES[ev.type]||TYPES.kultura;
  const soon=!live && (r.o.s-now)<3*3600e3;
  const more=ev.o.filter(x=>x.s>r.o.s);
  return '<details class="ev" data-id="'+id+'"'+(st.open.has(id)?' open':'')+'>'
   +'<summary><div class="stripe" style="background:'+T.c+'"></div>'
   +'<div class="when">'+whenCell(r,now)+'</div>'
   +'<div class="body"><span class="ty"><span class="dot" style="background:'+T.c+'"></span>'+T.n+'</span>'
   +'<h3>'+esc(ev.title)+'</h3>'
   +'<p class="place"><b>'+esc(p.name)+'</b>'+(p.town?', '+esc(p.town):'')+' · '+travelLabel(tr)+'</p>'
   +dayBar(r)
   +'<div class="meta">'
   +(live&&!ev.allDay?'<span class="tag live">právě probíhá</span>':'')
   +(soon?'<span class="tag live">začíná za '+fmtMin((r.o.s-now)/6e4)+'</span>':'')
   +ev.tags.map(t=>'<span class="tag">'+esc(t)+'</span>').join('')
   +'<span class="more">detail</span></div></div></summary>'
   +'<div class="detail">'
   +(ev.poster?'<img class="poster" loading="lazy" alt="Plakát akce '+esc(ev.title)+'" src="'+esc(ev.poster)+'">':'')
   +'<div><p>'+esc(ev.desc)+'</p>'
   +'<p><b>Vstupné:</b> '+esc(priceText(ev))+'</p>'
   +(more.length?'<p><b>Další termíny:</b> '+more.map(x=>dm(x.s)).join(', ')+'</p>':'')
   +'<p><a href="https://mapy.com/fnc/v1/route?end='+p.lon+','+p.lat+'&routeType='+MODES[st.mode].rt+'" target="_blank" rel="noopener">Navigovat ↗</a> · '
   +'<a href="'+esc(ev.src)+'" target="_blank" rel="noopener">Zdroj: '+esc(ev.srcName)+' ↗</a></p></div>'
   +'</div></details>';
}
function renderList(now){
  const all=rows(now), inReach=all.filter(r=>r.ok && (!st.place || st.place.includes(r.ev.place)));
  const out=all.length-all.filter(r=>r.ok).length, n=inReach.length;
  $('count').innerHTML='<b>'+n+'</b> '+(n>=1&&n<=4?'akce':'akcí')
    +(st.place?' · <a href="#" id="clr">zrušit výběr na mapě</a>':'')+(out?' · '+out+' mimo zvolený dosah':'');
  const c=$('clr'); if(c) c.onclick=e=>{e.preventDefault();st.place=null;render();};
  const L=$('list');
  if(!n){ L.innerHTML='<div class="empty"><b>V tomhle výběru nic není.</b> Zkus delší časové okno, větší dosah nebo méně filtrů.</div>'; return; }
  let html='';
  for(const [k,name] of ZONES){
    const zr=byTime(inReach.filter(r=>zoneOf(r)===k)); if(!zr.length) continue;
    const towns=[...new Set(zr.map(r=>r.p.town||r.p.name))];
    html+='<h2 class="zone">'+name+' <small>'+esc(towns.join(', '))+' · '+zr.length+'</small></h2><div class="list">'+zr.map(r=>card(r,now)).join('')+'</div>';
  }
  L.innerHTML=html;
  L.querySelectorAll('details.ev').forEach(d=>d.ontoggle=()=>{const id=+d.dataset.id; d.open?st.open.add(id):st.open.delete(id);});
}

// ---------- map ----------
let map, layer, meMarker, lastRows=[];
function initMap(){
  map=L.map('map',{zoomControl:true, attributionControl:true}).setView([st.origin.lat,st.origin.lon],11);
  L.tileLayer(API+'/maptiles/outdoor/256/{z}/{x}/{y}?apikey='+encodeURIComponent(KEY),{
    minZoom:6, maxZoom:19, attribution:'<a href="https://api.mapy.com/copyright" target="_blank" rel="noopener">&copy; Seznam.cz a.s. a další</a>'}).addTo(map);
  const Logo=L.Control.extend({options:{position:'bottomleft'}, onAdd(){ const a=L.DomUtil.create('a','mlogo');
    a.href='https://mapy.com/'; a.target='_blank'; a.rel='noopener'; a.innerHTML='<img alt="Mapy.com" width="100" src="https://api.mapy.com/img/api/logo.svg">'; return a; }});
  new Logo().addTo(map);
  map.attributionControl.setPrefix(false);
  layer=L.layerGroup().addTo(map);
  map.on('zoomend',()=>drawPins());
}
function drawPins(){
  if(!map) return; layer.clearLayers();
  const byP={};
  for(const r of lastRows){ const c=(byP[r.ev.place] ??= {ids:[r.ev.place],n:0,ok:false,ll:[r.p.lat,r.p.lon],pt:map.latLngToLayerPoint([r.p.lat,r.p.lon])}); c.n++; c.ok=c.ok||r.ok; }
  const cl=[];
  for(const c of Object.values(byP)){ const hit=cl.find(k=>k.pt.distanceTo(c.pt)<30);
    if(hit){hit.ids.push(...c.ids);hit.n+=c.n;hit.ok=hit.ok||c.ok;} else cl.push(c); }
  for(const c of cl){
    const sel=st.place && c.ids.some(id=>st.place.includes(id)), s=c.n>1?30:24;
    const m=L.marker(c.ll,{icon:L.divIcon({className:'',html:'<div class="pin'+(c.ok?'':' off')+(sel?' sel':'')+'" style="width:'+s+'px;height:'+s+'px">'+c.n+'</div>',iconSize:[s,s]}),
      title:c.ids.map(id=>P[id].name).join(', '), keyboard:true}).addTo(layer);
    m.on('click',()=>{ if(!c.ok) return; st.place=(st.place&&st.place.join()===c.ids.join())?null:c.ids; render(); });
  }
  if(meMarker) meMarker.remove();
  meMarker=L.marker([st.origin.lat,st.origin.lon],{icon:L.divIcon({className:'',html:'<div class="me" style="width:14px;height:14px"></div>',iconSize:[14,14]}),interactive:false,zIndexOffset:1000}).addTo(map);
}
function fitMap(){
  if(!map) return;
  const pts=lastRows.filter(r=>r.ok).map(r=>[r.p.lat,r.p.lon]); pts.push([st.origin.lat,st.origin.lon]);
  if(pts.length===1) map.setView(pts[0],13); else map.fitBounds(pts,{padding:[30,30],maxZoom:15});
}
function render(refit){
  const now=new Date();
  renderControls(now); renderList(now);
  lastRows=rows(now); drawPins(); if(refit) fitMap();
}

// ---------- origin ----------
function setOrigin(o){ st.origin=o; st.place=null; $('origin').value=o.name; say(''); render(true); loadRoutes(); }
async function geocode(q){
  if(!KEY) throw new Error('chybí klíč');
  const r=await fetch(API+'/geocode?apikey='+encodeURIComponent(KEY)+'&lang=cs&limit=1&locality=cz&query='+encodeURIComponent(q));
  if(!r.ok) throw new Error('HTTP '+r.status);
  const it=(await r.json()).items||[]; if(!it.length) return null;
  return {name:it[0].name, lat:it[0].position.lat, lon:it[0].position.lon};
}
$('whereForm').onsubmit=async e=>{
  e.preventDefault(); const q=$('origin').value.trim(); if(!q) return;
  const preset=ORIGINS.find(o=>o.name.toLowerCase()===q.toLowerCase()); if(preset) return setOrigin(preset);
  say('Hledám „'+q+'“…');
  try{ const o=await geocode(q); if(o) setOrigin(o); else say('Místo „'+q+'“ jsem nenašel. Zkus název obce.'); }
  catch(err){ say('Hledání místa teď nefunguje. Vyber obec ze seznamu.'); }
};
$('origin').onchange=()=>$('whereForm').requestSubmit();
$('gps').onclick=()=>{
  if(!navigator.geolocation) return say('Tento prohlížeč polohu nepodporuje.');
  say('Zjišťuji polohu…');
  navigator.geolocation.getCurrentPosition(
    p=>setOrigin({name:'Moje poloha', lat:p.coords.latitude, lon:p.coords.longitude}),
    ()=>say('Polohu se nepodařilo zjistit. Povol ji v prohlížeči, nebo napiš obec.'),
    {enableHighAccuracy:false, timeout:10000, maximumAge:300000});
};

// ---------- start ----------
(async function(){
  try{
    const d=await (await fetch('events.json',{cache:'no-cache'})).json();
    ORIGINS=d.origins; P=d.places;
    EVENTS=d.events.filter(e=>P[e.place]).map((e,i)=>({...e,id:i,tags:e.tags||[],o:e.occ.map(([s,x])=>({s:new Date(s),e:new Date(x)}))}));
    $('upd').textContent=dm(new Date(d.updated+'T12:00'))+' '+d.updated.slice(0,4);
    $('originList').innerHTML=ORIGINS.map(o=>'<option value="'+esc(o.name)+'">').join('');
    st.origin=ORIGINS[0]; $('origin').value=st.origin.name;
    initMap(); render(true); loadRoutes();
    setInterval(()=>render(),60000);
  }catch(err){ $('list').innerHTML='<div class="empty"><b>Data se nepodařilo načíst.</b> Zkus stránku obnovit.</div>'; console.error(err); }
})();
