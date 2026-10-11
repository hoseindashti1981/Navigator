import test from 'node:test';
import assert from 'node:assert/strict';
import {distance,classify,tracks,reversePoints,routeLength,segments,project,locate,deviation,exportRoute,validateImport} from '../public/assets/geo.mjs';
const point=(lat,lng,time=1000,extra={})=>({lat,lng,time,accuracy:5,altitude:null,speed:null,quality:'ok',gap:false,...extra});
test('haversine: known equatorial distance, identical points, antimeridian',()=>{
 assert.ok(Math.abs(distance(point(0,0),point(0,1))-111195)<2);
 assert.equal(distance(point(35,51),point(35,51)),0);
 assert.ok(distance(point(0,179.9),point(0,-179.9))<22300);
});
test('filter preserves uncertain samples and marks gaps; rejects invalid positions',()=>{
 const a=point(35,51);
 assert.equal(classify(point(95,51),a),null);
 assert.equal(classify(point(35,51,1000),a),null);
 assert.equal(classify(point(35,51,2000,{accuracy:200}),a).quality,'poor');
 assert.equal(classify(point(36,51,2000),a).quality,'jump');
 assert.equal(classify(point(36,51,2000),a,'driving',true).quality,'jump');
 assert.equal(classify(point(35,51,2000),a).quality,'duplicate');
 assert.equal(classify(point(35.001,51,40000),a).gap,true);
 assert.equal(classify(point(35,51,2000),a,'driving',true).gap,true);
 assert.equal(classify(point(35,51,4000),a,'driving',false,{maxTime:2}).quality,'ok');
});
test('distance never bridges missing data, rejected samples or explicit pauses',()=>{
 const a=point(0,0),b=point(0,.001,2000),c=point(1,1,3000,{gap:true}),d=point(1,1.001,4000);
 assert.equal(tracks([a,b,c,d]).length,2);
 assert.ok(routeLength([a,b,c,d])<225);
 const poor=point(.5,.5,2500,{quality:'poor'});
 assert.equal(tracks([a,b,poor,c,d]).length,2);
 assert.equal(tracks([a,point(0,0,1500,{quality:'duplicate'}),b]).length,1);
});
test('reversal swaps endpoints and preserves segment boundaries and length',()=>{
 const original=[point(0,0),point(0,.01,2000),point(1,1,3000,{gap:true}),point(1,1.01,4000)];
 const reversed=reversePoints(original);
 assert.equal(reversed[0].lng,1.01);assert.equal(reversed.at(-1).lng,0);
 assert.equal(tracks(reversed).length,2);
 assert.ok(Math.abs(routeLength(reversed)-routeLength(original))<.001);
 assert.equal(original[0].gap,false);
});
test('projection clamps to endpoints and measures progress',()=>{
 const geometry=segments([point(0,0),point(0,.01,2000)]);
 const c=project(point(.001,.005),geometry[0]);
 assert.ok(Math.abs(c.progress-geometry[0].length/2)<.001);
 assert.ok(Math.abs(c.distance-111.195)<.1);
 assert.equal(project(point(0,.02),geometry[0]).progress,geometry[0].length);
});
test('self-crossing exposes ambiguity initially, then uses continuity',()=>{
 const route=[point(0,0),point(0,.01,2000),point(.01,.01,3000),point(.01,0,4000),point(0,0,5000),point(0,-.01,6000)];
 const g=segments(route),p=point(0,0);
 assert.ok(locate(p,g).choices.length>=2);
 const result=locate(p,g,{progress:0,trackIndex:0},180);
 assert.equal(result.choices.length,0);assert.equal(result.candidate.progress,0);
 const afterGap=segments([point(0,0),point(0,.001,2000),point(.01,0,3000,{gap:true}),point(.01,.001,4000)]);
 assert.ok(locate(point(.01,.001),afterGap,{progress:30,trackIndex:0}).choices.length);
});
test('deviation accounts for accuracy and ignores unreliable locations',()=>{
 assert.equal(deviation(point(0,0,0,{accuracy:30}),{distance:50},45),false);
 assert.equal(deviation(point(0,0,0,{accuracy:5}),{distance:80},45),true);
 assert.equal(deviation(point(0,0,0,{accuracy:200}),{distance:800},45),false);
});
test('JSON round trip preserves full samples; GeoJSON and GPX keep gaps and metadata',()=>{
 const points=[point(0,0),point(0,.01,2000),point(.5,.5,3000,{quality:'poor'}),point(1,1,4000,{gap:true}),point(1,1.01,5000)];
 const route={name:'خانه & سفر <آزمایش>',description:'یادداشت',mode:'walking',duration_ms:4000};
 const json=exportRoute(route,points,'json');const imported=validateImport(JSON.parse(json));
 assert.equal(imported.points.length,5);assert.equal(imported.name,route.name);
 const geo=JSON.parse(exportRoute(route,points,'geojson'));
 assert.equal(geo.geometry.type,'MultiLineString');assert.equal(geo.geometry.coordinates.length,2);assert.equal(geo.properties.samples.length,5);
 const gpx=exportRoute(route,points,'gpx');assert.equal((gpx.match(/<trkseg>/g)||[]).length,2);
 assert.match(gpx,/خانه &amp; سفر &lt;آزمایش&gt;/);assert.match(gpx,/<ln:backup>/);assert.match(gpx,/<time>/);
 const singleton=JSON.parse(exportRoute(route,[points[0]],'geojson'));
 assert.equal(singleton.geometry.type,'GeometryCollection');assert.equal(singleton.geometry.geometries[0].type,'Point');
});
test('import rejects invalid, empty, nonmonotonic and malformed metadata',()=>{
 const base={version:1,route:{name:'مسیر'},points:[point(0,0),point(0,.01,2000)]};
 assert.throws(()=>validateImport({...base,points:[]}));
 assert.throws(()=>validateImport({...base,points:[point(100,0)]}));
 assert.throws(()=>validateImport({...base,points:[point(0,0),point(0,.01)]}));
 assert.throws(()=>validateImport({...base,points:[point(0,0,1000,{speed:-1})]}));
 assert.throws(()=>validateImport({...base,route:{name:' '}}));
 assert.throws(()=>validateImport({...base,route:{name:'مسیر',duration_ms:'bad'}}));
 assert.throws(()=>validateImport({...base,points:[point(0,0,1000,{quality:'poor'})]}));
});
