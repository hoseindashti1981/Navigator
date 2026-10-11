import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const base=process.env.NAVIGATOR_TEST_URL;
test('real PHP/MySQL API: security, durable tracks, retries, finalization and deletion',{skip:!base},async()=>{
 assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/$/,'Only a disposable loopback server may be tested');
 let cookie='',csrf='';
 async function request(action,body=null,id=null,customToken=csrf){
  const q=new URLSearchParams({action});if(id)q.set('id',id);
  const response=await fetch(base+'api.php?'+q,{method:body?'POST':'GET',headers:{Cookie:cookie,...(body?{'Content-Type':'application/json','X-CSRF-Token':customToken}:{})},body:body?JSON.stringify(body):undefined});
  const cookies=response.headers.getSetCookie();if(cookies.length)cookie=cookies.map(c=>c.split(';')[0]).join('; ');
  return {status:response.status,data:await response.json()};
 }
 let result=await request('me');assert.equal(result.status,200);csrf=result.data.csrf;assert.equal(result.data.setup,true);
 assert.equal((await request('list')).status,401);
 assert.equal((await request('setup',{username:'آزمون',password:'test-password-123456',token:'wrong'},null,'invalid')).status,403);
 assert.equal((await request('setup',{username:'آزمون',password:'test-password-123456',token:'wrong'})).status,403);
 result=await request('setup',{username:'آزمون',password:'test-password-123456',token:'local-test-setup-token-not-for-production-123456789'});assert.equal(result.status,200);csrf=result.data.csrf;
 assert.equal((await request('setup',{username:'other',password:'test-password-123456',token:'local-test-setup-token-not-for-production-123456789'})).status,403);
 const id=randomUUID(),created=Date.now();
 const p=(seq,lat,lng,time,extra={})=>({seq,lat,lng,time,accuracy:8,altitude:null,speed:10,quality:'ok',gap:false,...extra});
 const points=[p(0,35,51,created),p(1,35,51.001,created+5000),p(2,36,52,created+6000,{quality:'poor'}),p(3,36,52,created+45000,{gap:true}),p(4,36,52.001,created+50000)];
 const payload={id,name:'مسیر آزمون <خصوصی>',mode:'driving',created,duration:50000,points:points.slice(0,2)};
 result=await request('sync',payload);assert.equal(result.status,200);assert.equal(result.data.count,2);
 assert.equal((await request('sync',payload)).data.count,2);
 assert.equal((await request('sync',{...payload,points:[{...points[0],lat:1}]})).status,409);
 assert.equal((await request('sync',{...payload,points:[points[4]]})).status,409);
 assert.equal((await request('sync',{...payload,points:[{...points[2],lat:95}]})).status,400);
 result=await request('sync',{...payload,points:points.slice(2)});assert.equal(result.data.count,5);
 assert.equal((await request('finish',{id,name:'مسیر آزمون',description:'',count:4,duration:50000})).status,409);
 result=await request('finish',{id,name:payload.name,description:'یادداشت',count:5,duration:50000});assert.equal(result.status,200);
 assert.equal((await request('finish',{id,name:payload.name,description:'یادداشت',count:5,duration:50000})).status,200);
 result=await request('sync',payload);assert.equal(result.data.saved,true);assert.equal(result.data.count,5);
 result=await request('route',null,id);assert.equal(result.data.points.length,5);assert.ok(Number(result.data.route.distance_m)>175 && Number(result.data.route.distance_m)<185);
 assert.equal(result.data.route.origin_lat,35);assert.equal(result.data.route.destination_lat,36);assert.equal(result.data.route.description,'یادداشت');
 assert.equal((await request('edit',{id,name:'نام تازه',description:'ویرایش'})).status,200);
 assert.equal((await request('route',null,id)).data.route.name,'نام تازه');
 assert.equal((await request('logout',{})).status,200);assert.equal((await request('route',null,id)).status,401);
 result=await request('me');csrf=result.data.csrf;
 result=await request('login',{username:'آزمون',password:'wrong'});assert.equal(result.status,401);
 result=await request('login',{username:'آزمون',password:'test-password-123456'});assert.equal(result.status,200);csrf=result.data.csrf;
 assert.equal((await request('route',null,id)).data.points.length,5);
 assert.equal((await request('delete',{id})).status,200);assert.equal((await request('route',null,id)).status,404);
 assert.equal((await request('sync',payload)).status,410);
 assert.equal((await request('list')).data.routes.length,0);
 const empty=randomUUID();assert.equal((await request('sync',{...payload,id:empty,points:[]})).status,200);
 assert.equal((await request('finish',{id:empty,name:'خالی',count:0,duration:0})).status,400);
 await request('delete',{id:empty});
 // The per-IP window includes setup, wrong passwords and successful logins.
 await request('logout',{});result=await request('me');csrf=result.data.csrf;
 let limited=false;for(let i=0;i<12;i++){const r=await request('login',{username:'آزمون',password:'wrong'});if(r.status===429){limited=true;break;}}
 assert.equal(limited,true);
});
