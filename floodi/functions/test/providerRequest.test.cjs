const {test,afterEach,mock}=require('node:test');
const assert=require('node:assert/strict');const Module=require('node:module');
const path=require.resolve('../lib/utils/providerRequest');
function load(fetch, db, logs = []) {
  delete require.cache[path];const original=Module._load;
  Module._load=function(request,...args){
    if(request==='node-fetch')return fetch;
    if(request==='firebase-admin')return {apps:db?[{}]:[],firestore:()=>db};
    if(request==='firebase-functions/logger')return {warn:(message,details)=>logs.push({message,details}),error:()=>{},info:()=>{}};
    return original.call(this,request,...args);
  };
  try{return require(path);}finally{Module._load=original;}
}
const response=(status,data,retry)=>({ok:status>=200&&status<300,status,headers:{get:()=>retry},json:async()=>data});
afterEach(()=>{mock.restoreAll();mock.timers.reset();});
test('coalesces parallel equal provider requests and caches within the issue TTL',async()=>{
  let calls=0;const api=load(async()=>{calls++;return response(200,{measurement:3});});
  const [a,b]=await Promise.all([api.providerJson('https://example.test/data',{provider:'test',cacheMs:60000}),api.providerJson('https://example.test/data',{provider:'test',cacheMs:60000})]);
  assert.deepEqual(a,b);await api.providerJson('https://example.test/data',{provider:'test'});assert.equal(calls,1);
});
test('shared Firestore cache serves a fresh response without any upstream request',async()=>{
  let calls=0;const db={doc:path=>({get:async()=>({data:()=>path.includes('cooldown')?undefined:{data:{measurement:4},expiresAt:Date.now()+60000}})})};
  const api=load(async()=>{calls++;},db);assert.deepEqual(await api.providerJson('https://example.test/shared',{provider:'test'}),{measurement:4});assert.equal(calls,0);
});
test('429 honors provider Retry-After across different URLs without immediate retry traffic',async()=>{
  let calls=0;const api=load(async()=>{calls++;return response(429,{},'120');});
  await assert.rejects(api.providerJson('https://example.test/one',{provider:'test'}),error=>error.status===429);
  await assert.rejects(api.providerJson('https://example.test/two',{provider:'test'}),error=>error.code==='RATE_LIMIT_COOLDOWN');
  assert.equal(calls,1);
});
test('does not retry client errors or invalid JSON responses',async()=>{
  let calls=0;let api=load(async()=>{calls++;return response(400,{});});await assert.rejects(api.providerJson('https://example.test/bad',{provider:'test'}));assert.equal(calls,1);
  calls=0;api=load(async()=>{calls++;return {ok:true,json:async()=>{throw new SyntaxError('invalid json');}};});await assert.rejects(api.providerJson('https://example.test/json',{provider:'test'}),SyntaxError);assert.equal(calls,1);
});
test('performs only one bounded retry for transient upstream 503',async()=>{
  let calls=0;const api=load(async()=>{calls++;return response(calls===1?503:200,{ok:true},'0');});
  assert.deepEqual(await api.providerJson('https://example.test/transient',{provider:'test'}),{ok:true});assert.equal(calls,2);
});
test('long Retry-After returns failure instead of blocking a scheduled job',async()=>{
  let calls=0;const api=load(async()=>{calls++;return response(503,{},'120');});await assert.rejects(api.providerJson('https://example.test/long',{provider:'test'}));assert.equal(calls,1);
  assert.equal(api.retryDelayMs('Wed, 14 Oct 2026 12:02:00 GMT',0,Date.parse('2026-10-14T12:00:00Z')),120000);
});
test('round-trips nested GeoJSON through an opaque JSON string accepted by the real Firestore serializer',async()=>{
 const geometry={type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Polygon',coordinates:[[[-77.9,34],[-77.8,34],[-77.9,34]]]},properties:{observationStations:'https://api.weather.gov/stations'}}]};
 const stored=new Map();let calls=0;
 const db={doc:path=>({get:async()=>({data:()=>stored.get(path)}),set:async value=>{stored.set(path,value);}})};
 let api=load(async()=>{calls++;return response(200,geometry);},db);
 const first=await api.providerJson('https://example.test/geometry',{provider:'nws'});assert.deepEqual(first,geometry);
 const [cachePath,document]=[...stored.entries()].find(([key])=>!key.includes('cooldown'));
 assert.equal(document.data,undefined);assert.equal(typeof document.payloadJson,'string');assert.deepEqual(JSON.parse(document.payloadJson),geometry);assert.ok(document.deleteAfter instanceof Date);
 const {Firestore}=require('@google-cloud/firestore');const firestore=new Firestore({projectId:'demo-provider-cache-serializer'});
 // The Admin SDK can serialize the invalid shape; the production server rejects it.
 const unsafeBatch=firestore.batch();unsafeBatch.set(firestore.doc(cachePath),{data:geometry});
 assert.ok(JSON.stringify(unsafeBatch._ops[0].op()).includes('arrayValue'));
 const batch=firestore.batch();batch.set(firestore.doc(cachePath),document);const operation=batch._ops[0].op();
 assert.deepEqual(JSON.parse(operation.update.fields.payloadJson.stringValue),geometry);
 api=load(async()=>{calls++;throw new Error('Fresh shared cache should avoid upstream');},db);
 const second=await api.providerJson('https://example.test/geometry',{provider:'nws'});assert.deepEqual(second,geometry);assert.equal(calls,1);
});
test('invalid or error-shaped persisted payloads are never returned as successful provider data',async()=>{
 for(const record of [{payloadJson:'{malformed'},{payloadJson:JSON.stringify({error:true,reason:'rate limited'})},{data:{error:{message:'No data was found'}}},{payloadJson:'null'}]){
  let calls=0;const db={doc:path=>({get:async()=>({data:()=>path.includes('cooldown')?undefined:{...record,expiresAt:Date.now()+60000}}),set:async()=>{}})};
  const api=load(async()=>{calls++;return response(200,{measurement:5});},db);
  assert.deepEqual(await api.providerJson('https://example.test/recover-cache',{provider:'test'}),{measurement:5});assert.equal(calls,1);
 }
});
test('concurrent provider URLs and separate instances cannot shorten a longer shared Retry-After',async()=>{
 const stored=new Map();let queue=Promise.resolve();let resolveLong,resolveShort;
 const db={
  doc:path=>({path,get:async()=>({data:()=>stored.get(path)})}),
  runTransaction:work=>{const result=queue.then(()=>work({get:ref=>ref.get(),set:(ref,value)=>stored.set(ref.path,value)}));queue=result.catch(()=>{});return result;},
 };
 const long=load(async()=>new Promise(resolve=>{resolveLong=resolve;}),db);
 const short=load(async()=>new Promise(resolve=>{resolveShort=resolve;}),db);
 const longRequest=long.providerJson('https://example.test/hourly',{provider:'test'});
 const shortRequest=short.providerJson('https://example.test/other-url',{provider:'test'});
 while(!resolveLong||!resolveShort) await new Promise(resolve=>setImmediate(resolve));
 resolveLong(response(429,{},'3600'));await assert.rejects(longRequest,error=>error.status===429);
 const longerUntil=stored.get('provider_cache/cooldown_test').until;
 resolveShort(response(429,{},'60'));await assert.rejects(shortRequest,error=>error.status===429);
 assert.equal(stored.get('provider_cache/cooldown_test').until,longerUntil);
 let calls=0;const fresh=load(async()=>{calls++;return response(200,{unexpected:true});},db);
 await assert.rejects(fresh.providerJson('https://example.test/new-range',{provider:'test'}),error=>error.code==='RATE_LIMIT_COOLDOWN');assert.equal(calls,0);
});

function sharedStore() {
 const records=new Map();let queue=Promise.resolve();
 const db={
  doc:path=>({path,get:async()=>({data:()=>records.get(path)}),set:async value=>records.set(path,value)}),
  runTransaction:work=>{const result=queue.then(()=>work({get:ref=>ref.get(),set:(ref,value)=>records.set(ref.path,value)}));queue=result.catch(()=>{});return result;},
 };
 return {db,records};
}
const fixedTime=Date.parse('2026-10-16T12:00:00Z');
test('missing Retry-After escalates durable actual-429 streaks 15, 30, 60 minutes and caps subsequent delays',async()=>{
 mock.timers.enable({apis:['Date'],now:fixedTime});
 const {db,records}=sharedStore();let calls=0;
 for(const [index,minutes]of [15,30,60,60].entries()){
  const api=load(async()=>{calls++;return response(429,{},undefined);},db);
  const start=Date.now();
  await assert.rejects(api.providerJson(`https://example.test/range${index}`,{provider:'open_meteo'}),error=>error.status===429);
  const state=records.get('provider_cache/cooldown_open_meteo');
  assert.equal(state.streak,index+1);assert.equal(state.until-start,minutes*60000);
  const blocked=load(async()=>{throw new Error('must not send while cooling down');},db);
  await assert.rejects(blocked.providerJson('https://example.test/other',{provider:'open_meteo'}),error=>error.code==='RATE_LIMIT_COOLDOWN');
  assert.equal(records.get('provider_cache/cooldown_open_meteo').streak,index+1);
  mock.timers.setTime(state.until+1);
 }
 assert.equal(calls,4);
});
test('valid numeric and HTTP-date Retry-After override the adaptive fallback and malformed headers cannot leak into diagnostics',async()=>{
 mock.timers.enable({apis:['Date'],now:fixedTime});
 for(const [header,expected]of [['120',120000],['Fri, 16 Oct 2026 12:05:00 GMT',300000],['private-invalid-header',900000]]){
  const {db,records}=sharedStore();const logs=[];
  const api=load(async()=>response(429,{},header),db,logs);
  await assert.rejects(api.providerJson('https://example.test/header',{provider:'test'}));
  const state=records.get('provider_cache/cooldown_test');assert.equal(state.until-fixedTime,expected);
  const diagnostic=logs.find(log=>log.details.event==='provider_request_failed').details.rateLimit;
  assert.equal(diagnostic.cooldownMs,expected);assert.equal(diagnostic.source,header==='private-invalid-header'?'adaptive':'retry-after');
  assert.equal(JSON.stringify(logs).includes('private-invalid-header'),false);
 }
 const api=load(async()=>{});assert.equal(api.parseRetryAfterMs('-1',fixedTime),null);assert.equal(api.parseRetryAfterMs('0',fixedTime),0);
});
test('fresh successful upstream recovery resets the streak without moving its historical gate backward',async()=>{
 mock.timers.enable({apis:['Date'],now:fixedTime});const {db,records}=sharedStore();
 let api=load(async()=>response(429,{}),db);
 await assert.rejects(api.providerJson('https://example.test/failure',{provider:'test'}));
 const first=records.get('provider_cache/cooldown_test');mock.timers.setTime(first.until+1);
 api=load(async()=>response(200,{available:true}),db);
 assert.deepEqual(await api.providerJson('https://example.test/recovered',{provider:'test'}),{available:true});
 assert.equal(records.get('provider_cache/cooldown_test').streak,0);assert.equal(records.get('provider_cache/cooldown_test').until,first.until);
 api=load(async()=>response(429,{}),db);const started=Date.now();
 await assert.rejects(api.providerJson('https://example.test/new-failure',{provider:'test'}));
 assert.equal(records.get('provider_cache/cooldown_test').streak,1);assert.equal(records.get('provider_cache/cooldown_test').until-started,900000);
});
test('a success already in flight cannot reset a newer 429 streak or clear its longer gate',async()=>{
 mock.timers.enable({apis:['Date'],now:fixedTime});const {db,records}=sharedStore();
 records.set('provider_cache/cooldown_test',{until:fixedTime-1,streak:2,sequence:4});
 let resolveSuccess,resolveFailure;
 const successful=load(async()=>new Promise(resolve=>{resolveSuccess=resolve;}),db);
 const failing=load(async()=>new Promise(resolve=>{resolveFailure=resolve;}),db);
 const success=successful.providerJson('https://example.test/slow-success',{provider:'test'});
 const failure=failing.providerJson('https://example.test/new-limit',{provider:'test'});
 while(!resolveSuccess||!resolveFailure)await new Promise(resolve=>setImmediate(resolve));
 resolveFailure(response(429,{}));await assert.rejects(failure);
 const limited={...records.get('provider_cache/cooldown_test')};assert.equal(limited.streak,3);
 resolveSuccess(response(200,{available:true}));await success;
 assert.deepEqual(records.get('provider_cache/cooldown_test'),limited);
});
test('fresh cached responses remain usable during cooldown and never count as provider recovery',async()=>{
 mock.timers.enable({apis:['Date'],now:fixedTime});const {db,records}=sharedStore();
 const {createHash}=require('node:crypto');const url='https://example.test/cached';
 const key=createHash('sha256').update(url).digest('hex');
 records.set(`provider_cache/${key}`,{payloadJson:JSON.stringify({cached:true}),expiresAt:fixedTime+60000});
 records.set('provider_cache/cooldown_test',{until:fixedTime+3600000,streak:3,sequence:7});
 const api=load(async()=>{throw new Error('must not send during gate');},db);
 assert.deepEqual(await api.providerJson(url,{provider:'test'}),{cached:true});
 assert.equal(records.get('provider_cache/cooldown_test').streak,3);
});
test('rate-limit backoff is isolated by provider',async()=>{
 mock.timers.enable({apis:['Date'],now:fixedTime});const {db,records}=sharedStore();
 const api=load(async url=>url.includes('/limited')?response(429,{}):response(200,{ok:true}),db);
 await assert.rejects(api.providerJson('https://example.test/limited',{provider:'open_meteo'}));
 assert.deepEqual(await api.providerJson('https://example.test/nws',{provider:'nws'}),{ok:true});
 assert.equal(records.get('provider_cache/cooldown_open_meteo').streak,1);
});
