const {test,afterEach,mock}=require('node:test');
const assert=require('node:assert/strict');const Module=require('node:module');
const path=require.resolve('../lib/utils/providerRequest');
function load(fetch, db) {
  delete require.cache[path];const original=Module._load;
  Module._load=function(request,...args){
    if(request==='node-fetch')return fetch;
    if(request==='firebase-admin')return {apps:db?[{}]:[],firestore:()=>db};
    if(request==='firebase-functions/logger')return {warn:()=>{},error:()=>{},info:()=>{}};
    return original.call(this,request,...args);
  };
  try{return require(path);}finally{Module._load=original;}
}
const response=(status,data,retry)=>({ok:status>=200&&status<300,status,headers:{get:()=>retry},json:async()=>data});
afterEach(()=>mock.restoreAll());
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
