import {distance,valid,classify,tracks,reversePoints,routeLength,segments,locate,deviation,exportRoute,validateImport} from './geo.mjs';
import * as storage from './storage.mjs';

const $=id=>document.getElementById(id);
const fa=new Intl.NumberFormat('fa-IR',{maximumFractionDigits:1});
const date=new Intl.DateTimeFormat('fa-IR',{dateStyle:'medium',timeZone:'Asia/Tehran'});
const km=n=>fa.format(Number(n)/1000);
const duration=n=>{ const sec=Math.floor(Number(n)/1000);return [Math.floor(sec/3600),Math.floor(sec%3600/60),sec%60].filter((_,i)=>i>0||sec>=3600).map(n=>String(n).padStart(2,'0')).join(':').replace(/\d/g,d=>'۰۱۲۳۴۵۶۷۸۹'[d]); };
let csrf='',owner=null,setup=false,storageReady=false,routes=[],locals=[],recording=null,points=[],watch=null,followWatch=null,activeSince=null;
let pendingGap=true,lastGood=null,lastFix=null,currentPosition=null,queue=Promise.resolve(),syncing=null,lockRelease=null,wake=null,toastTimer;
let map,tileLayer,pathLayer,progressLayer,markerLayer,positionMarker,accuracyCircle,joinMarker,joinLine,detail=null,view='home',reversed=false,following=false;
let geometry=[],previousMatch=null,lastFollow=null,offCount=0,choices=[],drawAt=0,lastSavedAt=0,editPurpose='edit',threshold=45;
let sampling={drivingDistance:6,walkingDistance:3,maxTime:10};
try{threshold=Math.max(20,Math.min(300,Number(localStorage.getItem('navigator-threshold'))||45));}catch{}
try{
  const saved=JSON.parse(localStorage.getItem('navigator-sampling')||'null');
  if(saved && ['drivingDistance','walkingDistance','maxTime'].every(k=>Number.isFinite(saved[k])&&saved[k]>=1&&saved[k]<=30))sampling=saved;
}catch{}
$('deviation-setting').value=threshold;
const sampleSettings=el('div');sampleSettings.append(el('h3','جزئیات ثبت خط مسیر'));
for(const [key,label] of [['drivingDistance','فاصلهٔ نقاط خط در رانندگی (متر)'],['walkingDistance','فاصلهٔ نقاط خط در پیاده‌روی (متر)'],['maxTime','حداکثر زمان بین نقاط خط (ثانیه)']]){
  const field=el('label',label),input=el('input');input.id='sampling-'+key;input.type='number';input.min='1';input.max='30';input.value=sampling[key];field.append(input);sampleSettings.append(field);
}
sampleSettings.append(el('p','نمونه‌های نزدیک و تکراری در پشتیبان حفظ می‌شوند، ولی خط نقشه خلوت‌تر می‌ماند. تنظیمات تازه برای ضبط بعدی اعمال می‌شوند.','fine'));
$('save-settings').before(sampleSettings);

class ApiError extends Error { constructor(message,status){super(message);this.status=status;} }
function message(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,6500);}
function banner(text,warning=false){$('banner').textContent=text;$('banner').hidden=!text;$('banner').classList.toggle('warning',warning);}
function on(id,event,fn){$(id).addEventListener(event,async e=>{
  if(event==='submit')e.preventDefault();
  const button=e.currentTarget instanceof HTMLButtonElement?e.currentTarget:event==='submit'?e.currentTarget.querySelector('button'):null;
  if(button?.disabled)return;if(button)button.disabled=true;
  try{await fn(e);}catch(error){report(error);}finally{if(button)button.disabled=false;}
});}
function report(error){message(error.message||'عملیات انجام نشد. دوباره امتحان کنید.');}
function el(tag,text,className){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;}
async function api(action,data=null,id=null){
  const query=new URLSearchParams({action});if(id)query.set('id',id);
  let response;
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),20000);
  try{response=await fetch('api.php?'+query,{method:data?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:data?{'Content-Type':'application/json','X-CSRF-Token':csrf}:{},body:data?JSON.stringify(data):undefined,signal:controller.signal});}
  catch{throw new ApiError('ارتباط برقرار نشد. داده‌های ثبت‌شده روی دستگاه حفظ می‌شوند.',0);}
  finally{clearTimeout(timeout);}
  let result;try{result=await response.json();}catch{throw new ApiError('پاسخ سرور خوانا نیست. تنظیمات هاست را بررسی کنید.',response.status);}
  if(!response.ok) {
    if(response.status===401 && action!=='login'){
      banner('نشست ورود تمام شده است. ضبط روی دستگاه ادامه دارد؛ برای همگام‌سازی دوباره وارد شوید.',true);
      const b=el('button','ورود دوباره','secondary');b.addEventListener('click',showAuth);$('banner').append(b);
    }
    throw new ApiError(result.error||'درخواست انجام نشد.',response.status);
  }
  return result;
}
function showAuth(){ $('auth').hidden=false;$('shell').hidden=true;$('auth-title').textContent=setup?'ساخت حساب شخصی':'ورود به مسیرهای من';$('setup-field').hidden=!setup;$('login-button').textContent=setup?'ساخت حساب و ورود':'ورود به راه‌نگار ←';$('auth-note').textContent=setup?'کلید راه‌اندازی را از تنظیمات خصوصی سرور وارد کن.':'مسیرهای شما خصوصی و محفوظ هستند.'; }
function initMap(config){
  if(map)return;
  if(!window.L)throw new Error('فایل نقشه دریافت نشد. بارگذاری کامل فایل‌های برنامه را بررسی کنید.');
  map=L.map('map',{zoomControl:false}).setView([35.715,51.405],12);
  L.control.zoom({zoomInTitle:'بزرگ‌نمایی',zoomOutTitle:'کوچک‌نمایی'}).addTo(map);
  L.control.scale({imperial:false,position:'bottomleft'}).addTo(map);
  tileLayer=L.tileLayer(config.tile_url,{maxZoom:19,attribution:'<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">'+escapeHTML(config.tile_attribution)+'</a>',keepBuffer:2}).addTo(map);
  tileLayer.on('tileerror',()=>$('map-error').hidden=false);
  tileLayer.on('tileload',()=>$('map-error').hidden=true);
  pathLayer=L.layerGroup().addTo(map);progressLayer=L.layerGroup().addTo(map);markerLayer=L.layerGroup().addTo(map);
}
function escapeHTML(v){const n=el('span',String(v));return n.innerHTML;}
function mountMap(slot){$(slot).append($('map'));$('map').hidden=false;requestAnimationFrame(()=>map.invalidateSize());}
function icon(label){return L.divIcon({className:'point-marker',html:label,iconSize:[26,26],iconAnchor:[13,13]});}
function drawRoute(list,fit=false){
  if(!map)return;pathLayer.clearLayers();progressLayer.clearLayers();markerLayer.clearLayers();
  const lines=tracks(list);const accepted=lines.flat();
  for(const t of lines) {
    if(t.length>1)L.polyline(t.map(p=>[p.lat,p.lng]),{color:'#287260',weight:5,opacity:.9}).addTo(pathLayer);
    else L.circleMarker([t[0].lat,t[0].lng],{color:'#287260',radius:4}).addTo(pathLayer);
  }
  for(let i=1;i<lines.length;i++) {
    const p=lines[i][0];L.marker([p.lat,p.lng],{icon:icon('!')}).addTo(markerLayer).bindTooltip('شروع دوباره پس از وقفه؛ بخش میانی ثبت نشده است.');
  }
  if(accepted.length){
    const first=accepted[0],last=accepted.at(-1);
    L.marker([first.lat,first.lng],{icon:icon('آ')}).addTo(markerLayer).bindTooltip('آغاز مسیر');
    L.marker([last.lat,last.lng],{icon:icon('پ')}).addTo(markerLayer).bindTooltip('پایان مسیر');
    if(fit)map.fitBounds(L.latLngBounds(accepted.map(p=>[p.lat,p.lng])),{padding:[35,35],maxZoom:16});
  }
}
function updatePosition(p,center=false){
  currentPosition=p;
  if(!map)return;
  if(!positionMarker){positionMarker=L.circleMarker([p.lat,p.lng],{radius:8,color:'white',weight:3,fillColor:'#2682b2',fillOpacity:1}).addTo(map);accuracyCircle=L.circle([p.lat,p.lng],{radius:p.accuracy,color:'#2682b2',weight:1,fillOpacity:.08}).addTo(map);}
  positionMarker.setLatLng([p.lat,p.lng]);accuracyCircle.setLatLng([p.lat,p.lng]).setRadius(Math.min(p.accuracy,2000));
  if(center)map.setView([p.lat,p.lng],Math.max(map.getZoom(),16));
}
function pointFromPosition(position){const c=position.coords;return {lat:c.latitude,lng:c.longitude,time:Math.round(position.timestamp),accuracy:c.accuracy,altitude:Number.isFinite(c.altitude)?c.altitude:null,speed:Number.isFinite(c.speed)&&c.speed>=0?c.speed:null};}
function ensureGPS(){if(!window.isSecureContext)throw new Error('موقعیت‌یابی به اتصال HTTPS نیاز دارد.');if(!navigator.geolocation)throw new Error('موقعیت‌یابی در این مرورگر در دسترس نیست.');}
function gpsError(e){return e.code===1?'اجازهٔ موقعیت داده نشده است. دسترسی مکان Safari را در تنظیمات آیفون بررسی کن.':e.code===2?'موقعیت فعلاً در دسترس نیست. به فضای بازتر برو.':'دریافت موقعیت طول کشید؛ در انتظار سیگنال بهتر هستیم.';}
async function keepAwake(){try{if(navigator.wakeLock && document.visibilityState==='visible')wake=await navigator.wakeLock.request('screen');}catch{}}
async function releaseWake(){try{await wake?.release();}catch{}wake=null;}
async function acquireLock(id){
  if(lockRelease)return;
  if(!navigator.locks){banner('این مرورگر قفل هم‌زمانی ندارد؛ هنگام ضبط فقط یک تب از برنامه باز نگه دار.',true);return;}
  const ok=await new Promise((resolve,reject)=>{
    navigator.locks.request('navigator-record-'+id,{ifAvailable:true},async lock=>{
      if(!lock){resolve(false);return;}
      await new Promise(release=>{lockRelease=release;resolve(true);});
    }).catch(reject);
  });
  if(!ok)throw new Error('این ضبط در تب دیگری باز است. ابتدا آن تب را ببند.');
}
function releaseLock(){lockRelease?.();lockRelease=null;}
function currentDuration(){return (recording?.duration||0)+(activeSince===null?0:Math.max(0,Date.now()-activeSince));}
function checkpointTime(){if(recording && activeSince!==null){recording.duration=currentDuration();activeSince=Date.now();}}
async function persist(p=null){checkpointTime();await storage.saveSession(recording,p);}
function liveUI(){
  $('record-intro').hidden=!!recording;$('record-live').hidden=!recording;
  if(!recording)return;
  $('pause-record').textContent=watch===null?'ادامه ضبط':'توقف موقت';
  $('pause-record').disabled=!!(recording.finish||recording.discard);
  $('finish-record').disabled=!!(recording.finish||recording.discard);
  $('discard-record').disabled=!!recording.discard;
  if(recording.finish)$('gps-status').textContent='پایان ضبط؛ در انتظار ذخیرهٔ سرور';
  if(recording.discard)$('gps-status').textContent='ضبط لغو شد؛ حذف در انتظار سرور';
  $('live-duration').textContent=duration(currentDuration());
  $('live-distance').textContent=km(routeLength(points));
  $('live-speed').textContent=lastFix?.speed==null?'—':fa.format(lastFix.speed*3.6);
  $('live-accuracy').textContent=lastFix?fa.format(lastFix.accuracy):'—';
  const quality=points.filter(p=>p.quality==='poor'||p.quality==='jump').length;
  $('record-message').textContent=`${fa.format(points.length)} نمونه؛ ${fa.format(quality)} نمونهٔ نامطمئن برای بررسی حفظ شده است. نقاط نامطمئن و وقفه‌ها به خط مسیر اضافه نمی‌شوند.`;
}
function startWatch(){
  ensureGPS();stopFollow();activeSince=Date.now();pendingGap=true;$('gps-status').textContent='در انتظار GPS';
  const id=recording.id;
  watch=navigator.geolocation.watchPosition(position=>{
    queue=queue.then(async()=>{
      if(!recording || recording.id!==id || watch===null)return;
      const p=pointFromPosition(position);
      if(points.length && p.time<=points.at(-1).time)return;
      const next=classify(p,lastGood,recording.mode,pendingGap,recording.sampling||sampling);
      if(!next)return;
      if(points.length>=200000){await pauseRecord();message('ظرفیت این مسیر پر شده است. آن را ذخیره کن و مسیر تازه‌ای شروع کن.');return;}
      next.seq=points.length;
      points.push(next);recording.count=points.length;
      if(next.quality==='ok'){lastGood=next;pendingGap=false;}
      else if(next.quality!=='duplicate')pendingGap=true;
      lastFix=p;
      try{await persist(next);}catch(error){points.pop();recording.count=points.length;lastGood=points.findLast(p=>p.quality==='ok')||null;await pauseRecord().catch(()=>{});banner(error.message,true);return;}
      $('gps-status').textContent=next.quality==='poor'?'دقت GPS پایین است':next.quality==='jump'?'جهش موقعیت؛ نیاز به نمونهٔ بعدی':'● در حال ضبط';
      if(view==='record') {
        updatePosition(p,points.length===1);
        if(Date.now()-drawAt>2500){drawRoute(points);drawAt=Date.now();}
      }
      liveUI();
    }).catch(report);
  },e=>{pendingGap=true;$('gps-status').textContent=gpsError(e);if(e.code===1)pauseRecord().catch(report);},{enableHighAccuracy:true,maximumAge:0,timeout:15000});
  keepAwake();liveUI();
}
async function pauseRecord(){
  if(watch!==null)navigator.geolocation.clearWatch(watch);watch=null;
  checkpointTime();activeSince=null;pendingGap=true;
  await releaseWake();if(recording)await storage.saveSession(recording);
  $('gps-status').textContent='ضبط متوقف است';liveUI();
}
async function newRecording(){
  if(!storageReady)throw new Error('ذخیره‌سازی روی دستگاه در دسترس نیست؛ ضبط شروع نشد.');
  if(recording){location.hash='record';return;}
  ensureGPS();
  const me=await api('me');csrf=me.csrf;if(!me.authenticated){showAuth();throw new Error('ابتدا وارد حساب شو.');}
  if((await storage.sessions(owner)).length)throw new Error('ابتدا ضبط ناتمام قبلی را بازیابی یا حذف کن.');
  const id=crypto.randomUUID();await acquireLock(id);
  recording={id,owner,name:$('record-name').value.trim()||'مسیر '+date.format(Date.now()),description:'',mode:document.querySelector('input[name=mode]:checked').value,sampling:{...sampling},created:Date.now(),duration:0,count:0,ack:0};
  points=[];lastGood=null;lastFix=null;
  try{await persist();}catch(e){recording=null;releaseLock();throw e;}
  banner('هنگام ضبط صفحه را روشن و Safari را فعال نگه دار.');
  mountMap('record-map-slot');drawRoute([]);startWatch();sync().catch(()=>{});
}
async function sync(){
  if(syncing)return syncing;
  if(!recording || !navigator.onLine)return;
  syncing=(async()=>{
    const s=recording;
    if(s.discard){try{await api('delete',{id:s.id});}catch(e){if(e.status!==404)throw e;}await clearRecording();await refreshRoutes();return;}
    $('sync-status').textContent='در حال همگام‌سازی…';
    // A frozen snapshot bounds each request cycle; new points are sent on the next cycle.
    const count=points.length;
    do {
      if(recording!==s)return;
      const batch=points.slice(s.ack,Math.min(s.ack+300,count));
      const result=await api('sync',{id:s.id,name:s.name,mode:s.mode,created:s.created,duration:currentDuration(),points:batch});
      if(result.saved && !s.finish)throw new Error('نسخهٔ سرور قبلاً نهایی شده است. برای حفظ نقاط جدید، ابتدا فایل JSON ضبط را نگه دار.');
      if(!Number.isInteger(result.count)||result.count<s.ack||result.count>points.length)throw new Error('تعداد نقاط سرور با دستگاه متفاوت است. ضبط را متوقف و نسخهٔ سرور را بررسی کن.');
      s.ack=result.count;await persist();
    }while(s.ack<count);
    if(s.finish){
      await api('finish',{id:s.id,name:s.name,description:s.description,duration:s.duration,count:s.count});
      const id=s.id;await clearRecording();await refreshRoutes();location.hash='route/'+id;message('مسیر کامل روی سرور ذخیره شد.');
    }else $('sync-status').textContent=`${fa.format(s.ack)} از ${fa.format(points.length)} نمونه روی سرور`;
  })().catch(error=>{
    $('sync-status').textContent='همگام‌سازی انجام نشد؛ نقاط روی دستگاه هستند';
    if(error.status===401) $('sync-status').textContent='نیاز به ورود دوباره؛ نقاط روی دستگاه هستند';
    throw error;
  }).finally(()=>syncing=null);
  return syncing;
}
async function clearRecording(){await pauseRecord();const id=recording?.id;if(id)await storage.removeSession(id);recording=null;points=[];lastGood=null;lastFix=null;releaseLock();banner('');liveUI();}
async function refreshRoutes(){
  const result=await api('list');routes=result.routes;locals=storageReady?await storage.sessions(owner):[];
  const saved=routes.filter(r=>r.status==='saved');
  $('total-routes').textContent=fa.format(saved.length);$('total-distance').textContent=km(saved.reduce((s,r)=>s+Number(r.distance_m),0));$('total-hours').textContent=fa.format(saved.reduce((s,r)=>s+Number(r.duration_ms),0)/3600000);
  renderCards(saved.slice(0,3),$('recent'));renderLibrary();renderRecovery();
  if(!recording && (locals.length || routes.some(r=>r.status==='draft')))banner('یک ضبط ناتمام داری؛ از بخش «ضبط مسیر جدید» آن را بازیابی کن.');
}
function renderCards(list,target){
  target.replaceChildren();
  if(!list.length){const empty=el('div',undefined,'empty');empty.append(el('h3','هنوز مسیری اینجا نیست.'),el('p','یک سفر تازه را ضبط کن یا فایل مسیرت را وارد کن.'));target.append(empty);return;}
  for(const r of list){
    const card=el('a',undefined,'route-card');card.href='#route/'+r.id;
    const preview=el('div',undefined,'route-preview');
    // These are decorative route symbols; actual GPS geometry is shown in route details.
    const image=document.createElementNS('http://www.w3.org/2000/svg','svg');image.setAttribute('viewBox','0 0 200 70');image.setAttribute('aria-hidden','true');
    const path=document.createElementNS(image.namespaceURI,'path');path.setAttribute('d','M15 53 L62 45 L82 17 L124 36 L160 20 L187 13');path.setAttribute('fill','none');path.setAttribute('stroke','#6a8b63');path.setAttribute('stroke-width','3');path.setAttribute('stroke-linecap','round');image.append(path);
    preview.append(image,el('small',r.mode==='walking'?'پیاده‌روی':'رانندگی'));
    const body=el('div',undefined,'route-card-content'),meta=el('div',undefined,'route-card-meta');
    body.append(el('h3',r.name),el('time',date.format(Number(r.created_ms))));meta.append(el('span','↗ '+km(r.distance_m)+' کیلومتر'),el('span','◷ '+duration(r.duration_ms)));body.append(meta);card.append(preview,body);target.append(card);
  }
}
function renderLibrary(){let list=routes.filter(r=>r.status==='saved' && r.name.includes($('search').value.trim()));if($('sort').value==='old')list=[...list].reverse();renderCards(list,$('route-list'));}
function renderRecovery(){
  const target=$('recovery-list');target.replaceChildren();
  const all=new Map(routes.filter(r=>r.status==='draft').map(r=>[r.id,{id:r.id,name:r.name,server:true}]));
  for(const s of locals)all.set(s.id,{...s,server:false});
  for(const s of all.values()){
    if(recording?.id===s.id)continue;
    const row=el('div',undefined,'panel record-recovery');row.append(el('p',(s.discard?'حذف در انتظار اینترنت: ':s.finish?'ذخیره در انتظار اینترنت: ':'ضبط ناتمام: ')+s.name));
    const recover=el('button','بازیابی','secondary');recover.addEventListener('click',()=>recoverSession(s).catch(report));row.append(recover);target.append(row);
  }
}
async function recoverSession(source){
  if(recording)throw new Error('ابتدا ضبط فعلی را پایان بده یا از آن انصراف بده.');
  if(!storageReady)throw new Error('ذخیره‌سازی مرورگر در دسترس نیست.');
  await acquireLock(source.id);
  try{
    let s,list;
    if(source.server){
      const data=await api('route',null,source.id),r=data.route;list=data.points;
      s={id:r.id,owner,name:r.name,description:r.description,mode:r.mode,created:Number(r.created_ms),duration:Number(r.duration_ms),count:list.length,ack:list.length};
      await storage.saveBatch(s,list);
    }else{s=locals.find(s=>s.id===source.id);list=await storage.getPoints(s.id);list.sort((a,b)=>a.seq-b.seq);}
    if(list.length!==s.count || list.some((p,i)=>p.seq!==i))throw new Error('نقاط ذخیره‌شده روی دستگاه ناقص‌اند؛ نسخهٔ سرور را بررسی کن.');
    recording=s;points=list;lastGood=points.findLast(p=>p.quality==='ok')||null;lastFix=points.at(-1)||null;activeSince=null;pendingGap=true;
    await storage.saveSession(s);liveUI();mountMap('record-map-slot');drawRoute(points,true);$('gps-status').textContent='بازیابی شد؛ ضبط متوقف است';
    banner('ضبط قبلی بازیابی شد. ادامه بده، پایان و ذخیره را بزن یا انصراف بده.');renderRecovery();
    if(s.finish || s.discard)await sync();
  }catch(e){if(!recording)releaseLock();throw e;}
}
function detailPoints(){return reversed?reversePoints(detail.points):detail.points;}
async function openDetail(id){
  if(watch!==null)throw new Error('برای دنبال‌کردن مسیر، ابتدا ضبط جاری را متوقف یا ذخیره کن.');
  stopFollow();detail=await api('route',null,id);reversed=false;
  if(detail.route.status!=='saved')throw new Error('این مسیر هنوز نهایی نشده است. از بخش ضبط آن را بازیابی کن.');
  showPage('detail');$('detail-name').textContent=detail.route.name;$('detail-description').textContent=detail.route.description;
  $('detail-mode').textContent=detail.route.mode==='walking'?'پیاده‌روی':'رانندگی';
  $('detail-stats').replaceChildren(el('span','↗ '+km(detail.route.distance_m)+' کیلومتر'),el('span','◷ '+duration(detail.route.duration_ms)),el('span',date.format(Number(detail.route.created_ms))),el('span',fa.format(detail.points.length)+' نمونه'));
  mountMap('detail-map-slot');drawRoute(detail.points,true);$('reverse-route').textContent='⇄ مسیر برگشت';
}
function showPage(name){
  view=name;document.querySelectorAll('.page').forEach(p=>p.hidden=p.id!==name);
  document.querySelectorAll('[data-nav]').forEach(a=>a.classList.toggle('active',a.dataset.nav===(name==='detail'?'library':name)));
  const titles={home:'مسیر بعدی از اینجا شروع می‌شود.',library:'راه‌هایی که نگه داشته‌ای.',record:'مسیر تازه، خاطرهٔ تازه.',detail:'دوباره در همان مسیر.',settings:'همراهی مطمئن‌تر در راه.'};
  $('page-title').textContent=titles[name];
  if(name!=='detail')stopFollow();
  if(name==='record'){
    liveUI();renderRecovery();if(recording){mountMap('record-map-slot');drawRoute(points,true);}
  }
}
async function navigate(){
  if(owner===null)return;
  const hash=location.hash.slice(1)||'home';
  if(hash.startsWith('route/')){
    try{await openDetail(hash.slice(6));}catch(e){report(e);location.hash=watch!==null?'record':'library';}
  }else showPage(['home','record','library','settings'].includes(hash)?hash:'home');
}
function showJoin(candidate){
  if(joinMarker)map.removeLayer(joinMarker);if(joinLine)map.removeLayer(joinLine);
  joinMarker=L.marker([candidate.point.lat,candidate.point.lng],{icon:icon('و')}).addTo(map).bindTooltip('نقطهٔ پیوستن به مسیر');
  if(currentPosition && candidate.distance>20)joinLine=L.polyline([[currentPosition.lat,currentPosition.lng],[candidate.point.lat,candidate.point.lng]],{color:'#bb8e49',weight:2,dashArray:'5 7'}).addTo(map);
}
function acceptMatch(c){previousMatch=c;choices=[];$('join-choices').replaceChildren();showJoin(c);$('follow-status').textContent='بخش مسیر انتخاب شد؛ در انتظار موقعیت بعدی.';}
function followPosition(position){
  const p=pointFromPosition(position);if(!valid(p))return;updatePosition(p,!lastFollow);
  if(p.accuracy>100){$('follow-status').textContent='دقت GPS پایین است؛ پیشرفت و هشدار تا دریافت موقعیت بهتر متوقف‌اند.';return;}
  const elapsed=lastFollow?Math.max(1,(p.time-lastFollow.time)/1000):1;
  if(elapsed>30){previousMatch=null;offCount=0;}
  const movement=lastFollow?distance(lastFollow,p):0;
  const result=locate(p,geometry,previousMatch,Math.max(120,movement*2+p.accuracy*2));lastFollow=p;
  if(!result.candidate){$('follow-status').textContent='این مسیر برای دنبال‌کردن حداقل دو نقطهٔ متمایز لازم دارد.';return;}
  showJoin(result.candidate);
  offCount=deviation(p,result.candidate,threshold)?offCount+1:0;
  const away=offCount>=3;$('follow-status').classList.toggle('warning',away);
  if(away){$('join-choices').replaceChildren();$('follow-status').textContent=`از مسیر فاصله گرفته‌ای: حدود ${fa.format(result.candidate.distance)} متر. خط اتصال روی نقشه، جهت مستقیم است و راه خیابانی را مشخص نمی‌کند.`;return;}
  if(result.choices.length){
    choices=result.choices;$('follow-status').textContent='محل پیوستن یا ادامهٔ مسیر مبهم است. هنگام توقف، بخش درست را انتخاب کن. فاصلهٔ اتصال خط مستقیم است، نه مسیر خیابانی.';
    $('join-choices').replaceChildren(...choices.map((c,i)=>{const b=el('button',`بخش ${fa.format(c.trackIndex+1)} · ${km(c.progress)} کیلومتر از آغاز`,'secondary');b.addEventListener('click',()=>acceptMatch(c));return b;}));return;
  }
  $('join-choices').replaceChildren();const c=result.candidate;
  if(c.distance<=Math.max(threshold,p.accuracy*1.5+10))previousMatch=c;
  const total=geometry.at(-1).start+geometry.at(-1).length;
  const near=c.distance<=Math.max(threshold,p.accuracy*1.5+10);
  $('follow-status').textContent=near?`نزدیک مسیر هستی · ${fa.format(total?c.progress/total*100:0)}٪ پیشرفت · ${km(Math.max(0,total-c.progress))} کیلومتر از خط ثبت‌شده باقی مانده${tracks(detailPoints()).length>1?'؛ بخش‌های ثبت‌نشده محاسبه نشده‌اند.':''}`:`نقطهٔ پیوستن حدود ${fa.format(c.distance)} متر فاصلهٔ مستقیم دارد. مسیر خیابانی تا این نقطه محاسبه نشده است.`;
  progressLayer.clearLayers();const completed=[];let line=[],trackIndex=-1;
  for(const s of geometry){
    if(s.start>=c.progress)break;
    if(s.trackIndex!==trackIndex){if(line.length)completed.push(line);line=[[s.a.lat,s.a.lng]];trackIndex=s.trackIndex;}
    const t=Math.min(1,(c.progress-s.start)/s.length);
    line.push([s.a.lat+(s.b.lat-s.a.lat)*t,s.a.lng+(s.b.lng-s.a.lng)*t]);
  }
  if(line.length)completed.push(line);
  for(const t of completed)L.polyline(t,{color:'#8caa57',weight:5}).addTo(progressLayer);
}
function startFollow(){
  if(recording)throw new Error('ابتدا ضبط جاری را ذخیره کن یا از آن انصراف بده.');
  ensureGPS();geometry=segments(detailPoints());if(!geometry.length)throw new Error('مسیر برای دنبال‌کردن حداقل دو نقطهٔ متمایز لازم دارد.');
  following=true;previousMatch=null;lastFollow=null;offCount=0;$('follow-status').hidden=false;$('follow-status').textContent='در انتظار موقعیت فعلی…';$('follow-route').textContent='توقف دنبال‌کردن';
  followWatch=navigator.geolocation.watchPosition(p=>{try{followPosition(p);}catch(e){report(e);}},e=>{$('follow-status').textContent=gpsError(e);},{enableHighAccuracy:true,maximumAge:0,timeout:15000});keepAwake();
}
function stopFollow(){
  if(followWatch!==null)navigator.geolocation.clearWatch(followWatch);followWatch=null;following=false;previousMatch=null;lastFollow=null;offCount=0;
  if(joinMarker){map?.removeLayer(joinMarker);joinMarker=null;}if(joinLine){map?.removeLayer(joinLine);joinLine=null;}
  $('follow-route').textContent='◎ دنبال کردن مسیر';$('follow-status').hidden=true;$('follow-status').classList.remove('warning');$('join-choices').replaceChildren();
  if(watch===null)releaseWake();
}
function openEditor(purpose){editPurpose=purpose;$('edit-title').textContent=purpose==='finish'?'پایان و ذخیرهٔ مسیر':'ویرایش مسیر';$('edit-name').value=purpose==='finish'?recording.name:detail.route.name;$('edit-description').value=purpose==='finish'?recording.description:detail.route.description;$('edit-dialog').showModal();}
async function importFile(file){
  if(!file)return;if(recording || (await storage.sessions(owner)).length)throw new Error('ابتدا ضبط ناتمام را ذخیره یا حذف کن.');
  if(file.size>35000000)throw new Error('حجم فایل نباید بیش از ۳۵ مگابایت باشد.');
  const text=await file.text();let data;
  if(file.name.toLowerCase().endsWith('.gpx')){
    if(/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error('فایل GPX شامل ساختار مجاز نیست.');
    const doc=new DOMParser().parseFromString(text,'application/xml');if(doc.querySelector('parsererror'))throw new Error('فایل GPX خوانا نیست.');
    const backup=doc.getElementsByTagNameNS('https://lineyar.ir/navigator','backup')[0];
    if(backup)data=JSON.parse(backup.textContent);
    else{
      const list=[];for(const seg of doc.getElementsByTagNameNS('*','trkseg')){
        let gap=true;for(const pt of seg.getElementsByTagNameNS('*','trkpt')){
          const time=Date.parse(pt.getElementsByTagNameNS('*','time')[0]?.textContent||'');
          if(!Number.isFinite(time))throw new Error('برای ورود GPX خارجی، هر نقطه باید زمان معتبر داشته باشد.');
          if(!pt.hasAttribute('lat')||!pt.hasAttribute('lon'))throw new Error('مختصات نقطه ناقص است.');
          list.push({lat:Number(pt.getAttribute('lat')),lng:Number(pt.getAttribute('lon')),time,accuracy:0,altitude:pt.getElementsByTagNameNS('*','ele')[0]?Number(pt.getElementsByTagNameNS('*','ele')[0].textContent):null,speed:null,quality:'ok',gap});gap=false;
        }
      }
      data={version:1,route:{name:doc.getElementsByTagNameNS('*','name')[0]?.textContent||file.name,description:'واردشده از GPX؛ دقت GPS در فایل خارجی ممکن است موجود نباشد.'},points:list};
    }
  }else data=JSON.parse(text);
  const imported=validateImport(data);const id=crypto.randomUUID();await acquireLock(id);
  const s={id,owner,name:imported.name,description:imported.description,mode:imported.mode,created:imported.points[0].time,duration:imported.duration,count:imported.points.length,ack:0,finish:true};
  try{await storage.saveBatch(s,imported.points);}catch(e){releaseLock();throw e;}
  recording=s;points=imported.points;activeSince=null;lastGood=points.findLast(p=>p.quality==='ok');liveUI();location.hash='record';await sync();
}

on('login-form','submit',async e=>{
  e.preventDefault();$('auth-error').textContent='';$('login-button').disabled=true;
  try{
    const me=await api('me');csrf=me.csrf;setup=me.setup;
    const result=await api(setup?'setup':'login',{username:$('username').value,password:$('password').value,token:$('setup-token').value});csrf=result.csrf;owner=result.user;$('password').value='';$('setup-token').value='';
    initMap(me);$('auth').hidden=true;$('shell').hidden=false;banner('');await refreshRoutes();await navigate();
  }catch(e){$('auth-error').textContent=e.message;}finally{$('login-button').disabled=false;}
});
async function logout(){
  if(recording || following)throw new Error('ابتدا ضبط یا دنبال‌کردن مسیر را پایان بده.');
  await api('logout',{});owner=null;detail=null;routes=[];locals=[];pathLayer?.clearLayers();markerLayer?.clearLayers();
  if(positionMarker){map.removeLayer(positionMarker);map.removeLayer(accuracyCircle);positionMarker=null;accuracyCircle=null;}currentPosition=null;
  showAuth();
}
on('logout','click',logout);
const mobileLogout=el('button','خروج از حساب','secondary');mobileLogout.id='settings-logout';document.querySelector('.settings-panel').append(mobileLogout);on('settings-logout','click',logout);
on('start-record','click',newRecording);
on('pause-record','click',async()=>{
  if(!recording)return;if(recording.finish || recording.discard)throw new Error('این ضبط در انتظار ذخیره یا حذف است.');
  if(watch!==null){await pauseRecord();await queue;await sync();}else{startWatch();}
});
on('finish-record','click',async()=>{
  if(recording?.discard)throw new Error('این ضبط در انتظار حذف است.');
  await pauseRecord();await queue;
  if(!points.some(p=>p.quality==='ok'))throw new Error('هنوز نقطهٔ قابل اعتمادی ثبت نشده است. ضبط را ادامه بده.');
  openEditor('finish');
});
on('discard-record','click',async()=>{
  if(!confirm('ضبط و همهٔ نقاط آن حذف شوند؟'))return;
  await pauseRecord();await queue;if(syncing)await syncing.catch(()=>{});
  if(!recording)return;
  // Persist deletion intent first, so an offline cancellation cannot resurrect on retry.
  recording.discard=true;recording.finish=false;await persist();
  if(recording.ack===0){
    try{await api('delete',{id:recording.id});}catch(e){if(e.status!==404)throw e;}
    await clearRecording();
  }else await sync();
  await refreshRoutes();location.hash='home';message('ضبط حذف شد.');
});
on('edit-form','submit',async e=>{
  e.preventDefault();const name=$('edit-name').value.trim(),description=$('edit-description').value.trim();if(!name)throw new Error('نام مسیر را بنویس.');
  if(editPurpose==='finish'){
    recording.name=name;recording.description=description;recording.finish=true;await persist();$('edit-dialog').close();
    if(!navigator.onLine){message('مسیر روی دستگاه نگه داشته شد؛ پس از اتصال اینترنت روی سرور ذخیره می‌شود.');return;}
    if(syncing)await syncing.catch(()=>{});if(recording)await sync();
  }else{await api('edit',{id:detail.route.id,name,description});$('edit-dialog').close();await refreshRoutes();await openDetail(detail.route.id);}
});
on('edit-cancel','click',()=>$('edit-dialog').close());
on('edit-route','click',()=>openEditor('edit'));
on('delete-route','click',async()=>{if(!confirm('این مسیر برای همیشه از سرور حذف شود؟'))return;await api('delete',{id:detail.route.id});stopFollow();await refreshRoutes();location.hash='library';message('مسیر حذف شد.');});
on('reverse-route','click',()=>{
  stopFollow();reversed=!reversed;drawRoute(detailPoints(),true);$('reverse-route').textContent=reversed?'⇄ نمایش مسیر اصلی':'⇄ مسیر برگشت';
  if(reversed)banner('مسیر برگشت فقط ترتیب معکوس نقاط GPS است. یک‌طرفه‌ها، محدودیت پیچ‌ها و شرایط فعلی راه را رعایت کن.',true);else banner('');
});
on('follow-route','click',()=>{if(following){stopFollow();drawRoute(detailPoints());}else startFollow();});
on('center-map','click',()=>drawRoute(detailPoints(),true));
on('locate-me','click',()=>{if(!currentPosition)throw new Error('هنوز موقعیت فعلی دریافت نشده است. ضبط یا دنبال‌کردن را شروع کن.');map.setView([currentPosition.lat,currentPosition.lng],16);});
function downloadRoute(route,list,format){
  const content=exportRoute(route,list,format);const url=URL.createObjectURL(new Blob([content],{type:format==='gpx'?'application/gpx+xml;charset=utf-8':'application/json;charset=utf-8'}));const a=el('a');a.href=url;a.download=route.name.replace(/[\\/:*?"<>|]/g,'_')+'.'+format;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);message('فایل مسیر برای دریافت آماده شد.');
}
for(const button of document.querySelectorAll('[data-export]'))button.addEventListener('click',()=>{try{downloadRoute(detail.route,detail.points,button.dataset.export);}catch(e){report(e);}});
on('backup-record','click',()=>{if(!points.length)throw new Error('هنوز نقطه‌ای ثبت نشده است.');downloadRoute({name:recording.name,description:recording.description,mode:recording.mode,duration_ms:currentDuration(),created_ms:recording.created},points,'json');});
on('search','input',renderLibrary);on('sort','change',renderLibrary);
on('import-button','click',()=>{if(!storageReady)throw new Error('ذخیره‌سازی دستگاه در دسترس نیست.');$('import-file').click();});
on('import-file','change',async()=>{const file=$('import-file').files[0];$('import-file').value='';try{await importFile(file);}catch(e){throw new Error(e instanceof SyntaxError?'ساختار فایل معتبر نیست.':e.message);}});
on('save-settings','click',()=>{
  const value=Number($('deviation-setting').value);if(!Number.isFinite(value)||value<20||value>300)throw new Error('حد هشدار باید بین ۲۰ و ۳۰۰ متر باشد.');
  const next={};for(const key of Object.keys(sampling)){next[key]=Number($('sampling-'+key).value);if(!Number.isFinite(next[key])||next[key]<1||next[key]>30)throw new Error('مقدارهای ثبت خط باید بین ۱ و ۳۰ باشند.');}
  localStorage.setItem('navigator-sampling',JSON.stringify(next));localStorage.setItem('navigator-threshold',String(value));sampling=next;threshold=value;message('تنظیمات ذخیره شد.');
});
window.addEventListener('hashchange',()=>navigate().catch(report));
function network(){ $('network').textContent=navigator.onLine?'متصل به اینترنت':'بدون اینترنت';if(!navigator.onLine && recording)$('sync-status').textContent='بدون اینترنت؛ ذخیره روی دستگاه'; }
window.addEventListener('online',()=>{network();sync().catch(report);});window.addEventListener('offline',network);
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden'){
    pendingGap=true;if(recording){checkpointTime();storage.saveSession(recording).catch(report);}previousMatch=null;
  }else{
    pendingGap=true;if(watch!==null || following)keepAwake();
    if(recording)banner('پس از بازگشت به صفحه، ممکن است بخشی از مسیر ثبت نشده باشد. ادامهٔ ضبط با بخش تازه مشخص می‌شود.');
    sync().catch(()=>{});
  }
});
window.addEventListener('beforeunload',e=>{if(watch!==null){e.preventDefault();e.returnValue='';}});
setInterval(()=>{
  if(recording){liveUI();if(Date.now()-lastSavedAt>15000){lastSavedAt=Date.now();persist().catch(report);sync().catch(()=>{});}}
},1000);
async function boot(){
  network();try{await storage.openStorage();storageReady=true;}catch(e){banner(e.message,true);}
  try{const me=await api('me');csrf=me.csrf;setup=me.setup;owner=me.user;
    if(me.authenticated){initMap(me);$('auth').hidden=true;$('shell').hidden=false;await refreshRoutes();await navigate();}
    else showAuth();
  }catch(e){$('auth-error').textContent=e.message;$('login-button').disabled=true;}
}
boot();
