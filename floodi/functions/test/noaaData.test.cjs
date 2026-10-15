const {test}=require('node:test');const assert=require('node:assert/strict');const Module=require('node:module');
const noaaPath=require.resolve('../lib/etl/noaa'),providerPath=require.resolve('../lib/utils/providerRequest');
function load(data){const requests=[];delete require.cache[noaaPath];delete require.cache[providerPath];const original=Module._load;
 Module._load=function(request,...args){if(request==='node-fetch')return async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>data};};if(request==='firebase-admin')return {apps:[]};return original.call(this,request,...args);};
 try{return {...require(noaaPath),requests};}finally{Module._load=original;}}
test('astronomical predictions share a stable UTC-day request while each caller receives only its exact interval',async()=>{
 const api=load({predictions:[{t:'2026-10-14 00:00',v:'1'},{t:'2026-10-14 12:06',v:'3'},{t:'2026-10-14 12:12',v:'3.2'},{t:'2026-10-14 23:54',v:'2'}]});
 const first=await api.fetchNoaaPredictions('8658163',new Date('2026-10-14T12:01Z'),new Date('2026-10-14T18:01Z'));
 const second=await api.fetchNoaaPredictions('8658163',new Date('2026-10-14T12:10Z'),new Date('2026-10-14T18:10Z'));
 assert.equal(api.requests.length,1);assert.deepEqual(first,{'2026-10-14T12:06Z':3,'2026-10-14T12:12Z':3.2});assert.deepEqual(second,{'2026-10-14T12:12Z':3.2});
 const url=new URL(api.requests[0].url);assert.equal(url.searchParams.get('begin_date'),'20261014 00:00');assert.equal(url.searchParams.get('end_date'),'20261014 23:59');assert.equal(url.searchParams.get('datum'),'MLLW');assert.equal(url.searchParams.get('units'),'english');
});
test('observed water requests preserve precise boundaries and reject missing values without fabricating zero',async()=>{
 const api=load({data:[{t:'2026-10-14 12:06',v:''},{t:'2026-10-14 12:12',v:'  '},{t:'2026-10-14 12:18',v:'0'},{t:'invalid',v:'3'},{t:'2026-10-14 12:24',v:'bad'}]});
 const result=await api.fetchNoaaObserved('8658163',new Date('2026-10-14T12:03Z'),new Date('2026-10-14T12:29Z'));
 assert.deepEqual(result,{'2026-10-14T12:18Z':0});const url=new URL(api.requests[0].url);assert.equal(url.searchParams.get('begin_date'),'20261014 12:03');assert.equal(url.searchParams.get('end_date'),'20261014 12:29');
});
