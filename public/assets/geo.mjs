export const EARTH = 6371008.8;
const rad = Math.PI / 180;
export function valid(p) {
  return p && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 && Number.isFinite(p.lng) && Math.abs(p.lng) <= 180;
}
export function distance(a, b) {
  const h = Math.sin((b.lat-a.lat)*rad/2)**2 + Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin((b.lng-a.lng)*rad/2)**2;
  return EARTH*2*Math.asin(Math.sqrt(Math.min(1,Math.max(0,h))));
}
export function classify(p, previous, mode='driving', forceGap=false, sampling={}) {
  if (!valid(p) || !Number.isFinite(p.time) || !Number.isFinite(p.accuracy) || p.accuracy < 0) return null;
  const result = {...p, quality:'ok', gap:forceGap};
  if (p.accuracy > (mode==='walking'?60:100)) result.quality='poor';
  else if (previous) {
    const seconds=(p.time-previous.time)/1000;
    if (seconds<=0) return null;
    const meters=distance(previous,p);
    const maxSpeed=mode==='walking'?12:75;
    if (seconds<45 && meters>maxSpeed*seconds + p.accuracy + previous.accuracy) result.quality='jump';
    else if (!forceGap && seconds<(sampling.maxTime??10) && meters<(mode==='walking'?(sampling.walkingDistance??3):(sampling.drivingDistance??6))) result.quality='duplicate';
    if (seconds>30) result.gap=true;
  }
  return result;
}
export function tracks(points) {
  const result=[]; let track=[]; let broken=false;
  for (const p of points) {
    if (p.quality!=='ok') { if (p.quality!=='duplicate') broken=true; continue; }
    if ((p.gap || broken) && track.length) { result.push(track); track=[]; }
    track.push(p); broken=false;
  }
  if(track.length) result.push(track);
  return result;
}
export function reversePoints(points) {
  return tracks(points).reverse().flatMap(t=>[...t].reverse().map((p,i)=>({...p,gap:i===0})));
}
export function routeLength(points) {
  return tracks(points).reduce((n,t)=>n+t.slice(1).reduce((s,p,i)=>s+distance(t[i],p),0),0);
}
export function segments(points) {
  let progress=0; const result=[];
  for (const [trackIndex,t] of tracks(points).entries()) {
    for(let i=1;i<t.length;i++) {
      const length=distance(t[i-1],t[i]);
      if(length>0) result.push({a:t[i-1],b:t[i],length,start:progress,trackIndex});
      progress+=length;
    }
  }
  return result;
}
export function project(p,s) {
  const scale=Math.cos((s.a.lat+s.b.lat)*rad/2);
  const dx=((s.b.lng-s.a.lng+540)%360-180)*rad*EARTH*scale;
  const dy=(s.b.lat-s.a.lat)*rad*EARTH;
  const px=((p.lng-s.a.lng+540)%360-180)*rad*EARTH*scale;
  const py=(p.lat-s.a.lat)*rad*EARTH;
  const t=Math.max(0,Math.min(1,(px*dx+py*dy)/(dx*dx+dy*dy || 1)));
  const point={lat:s.a.lat+(s.b.lat-s.a.lat)*t,lng:((s.a.lng+((s.b.lng-s.a.lng+540)%360-180)*t+540)%360)-180};
  return {point, distance:distance(p,point),progress:s.start+s.length*t,trackIndex:s.trackIndex};
}
export function locate(p, geometry, previous=null, window=180) {
  const candidates=geometry.map(s=>project(p,s)).sort((a,b)=>a.distance-b.distance);
  if(!candidates.length) return {candidate:null,choices:[]};
  let best=candidates[0];
  if(previous) {
    const local=candidates.filter(c=>c.trackIndex===previous.trackIndex && c.progress>=previous.progress-50 && c.progress<=previous.progress+window);
    if(local.length && local[0].distance<=best.distance+Math.max(15,p.accuracy)) return {candidate:local[0],choices:[]};
  }
  const distinct=[];
  for(const c of candidates) {
    if(c.distance>best.distance+Math.max(12,Math.min(p.accuracy,30))) break;
    if(distinct.every(d=>Math.abs(d.progress-c.progress)>70 || d.trackIndex!==c.trackIndex)) distinct.push(c);
    if(distinct.length===4) break;
  }
  return {candidate:best,choices:previous || distinct.length>1 ? distinct : []};
}
export function deviation(p,candidate,threshold=45) {
  return p.accuracy<=100 && candidate.distance>Math.max(threshold,p.accuracy*1.5+10);
}
const xml = v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function exportRoute(route,points,format) {
  const data={version:1,route,points};
  if(format==='json') return JSON.stringify(data,null,2);
  if(format==='geojson') return JSON.stringify({type:'Feature',properties:{...route,samples:points},geometry:{type:'MultiLineString',coordinates:tracks(points).map(t=>t.map(p=>[p.lng,p.lat,...(p.altitude===null?[]:[p.altitude])]))}},null,2);
  if(format!=='gpx') throw new Error('قالب خروجی شناخته نشد.');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Lineyar Navigator" xmlns="http://www.topografix.com/GPX/1/1" xmlns:ln="https://lineyar.ir/navigator">'+
    '<metadata><name>'+xml(route.name)+'</name><desc>'+xml(route.description||'')+'</desc><extensions><ln:backup>'+xml(JSON.stringify(data))+'</ln:backup></extensions></metadata><trk><name>'+xml(route.name)+'</name>'+
    tracks(points).map(t=>'<trkseg>'+t.map(p=>`<trkpt lat="${p.lat}" lon="${p.lng}">${p.altitude===null?'':`<ele>${p.altitude}</ele>`}<time>${new Date(p.time).toISOString()}</time><extensions><ln:accuracy>${p.accuracy}</ln:accuracy></extensions></trkpt>`).join('')+'</trkseg>').join('')+'</trk></gpx>';
}
export function validateImport(data) {
  if(data?.version!==1 || !Array.isArray(data.points) || !data.points.length || data.points.length>200000) throw new Error('فایل مسیر معتبر نیست یا بیش از ۲۰۰ هزار نقطه دارد.');
  if(typeof data.route?.name!=='string' || !data.route.name.trim() || [...data.route.name].length>200) throw new Error('نام مسیر معتبر نیست.');
  if(data.route.description!=null && (typeof data.route.description!=='string' || [...data.route.description].length>4000)) throw new Error('یادداشت مسیر معتبر نیست یا بیش از حد طولانی است.');
  const duration=Number(data.route.duration_ms ?? 0);
  if(!Number.isFinite(duration) || duration<0 || duration>31536000000) throw new Error('زمان ضبط فایل معتبر نیست.');
  let last=-1;
  const points=data.points.map((p,i)=>{
    if(!valid(p) || !Number.isSafeInteger(p.time) || p.time<0 || p.time>4102444800000 || p.time<=last || !Number.isFinite(p.accuracy) || p.accuracy<0 || p.accuracy>100000 || !['ok','poor','jump','duplicate'].includes(p.quality)) throw new Error('مختصات، زمان یا دقت نقاط فایل معتبر نیست.');
    for(const key of ['altitude','speed']) if(p[key]!=null && (!Number.isFinite(p[key]) || p[key]<(key==='speed'?0:-12000) || p[key]>(key==='speed'?1000:100000))) throw new Error('اطلاعات ارتفاع یا سرعت معتبر نیست.');
    last=p.time; return {...p,seq:i,altitude:p.altitude??null,speed:p.speed??null,gap:!!p.gap};
  });
  if(!points.some(p=>p.quality==='ok')) throw new Error('فایل هیچ نقطهٔ قابل اعتمادی ندارد.');
  return {name:data.route.name.trim(),description:data.route.description||'',mode:data.route.mode==='walking'?'walking':'driving',duration,points};
}
