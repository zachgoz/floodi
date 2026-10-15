const {test}=require('node:test');const assert=require('node:assert/strict');const Module=require('node:module');
const storagePath=require.resolve('../lib/utils/storage');
const now='2026-10-14T11:06:00.000Z';
function load(fetch){
 const saved=[];delete require.cache[storagePath];const original=Module._load;
 Module._load=function(request,...args){
  if(request==='node-fetch')return fetch;
  if(request==='firebase-admin')return {storage:()=>({bucket:()=>({file:destination=>({exists:async()=>[false],save:async(buffer,options)=>saved.push({destination,buffer,options})})})})};
  if(request==='firebase-functions/logger')return {warn:()=>{},info:()=>{},error:()=>{}};
  return original.call(this,request,...args);
 };
 try{return {...require(storagePath),saved};}finally{Module._load=original;}
}
test('image downloads have finite network timeout and byte limit and batchwork is capped',async()=>{
 const requests=[];const api=load(async(url,options)=>{requests.push({url,options});return {ok:true,buffer:async()=>Buffer.from('jpeg'),headers:{get:()=> 'image/jpeg'}};});
 const result=await api.persistImageryBatch('carolina-beach',{[now]:{CAM1:'https://images.example/one.jpg',CAM2:'https://images.example/two.jpg'}},{[now]:6},5.6,{maxImages:1});
 assert.equal(result.attempted,1);assert.equal(result.succeeded,1);assert.equal(result.deferred,true);assert.equal(requests.length,1);
 assert.equal(requests[0].options.timeout,10000);assert.equal(requests[0].options.size,8000000);
 assert.equal(api.saved.length,1);assert.match(result.patch[now].CAM1,/^storage:\/\//);
});
test('a failed camera is isolated and a different camera still archives',async()=>{
 const api=load(async url=>url.includes('bad')?{ok:false,status:503}:{ok:true,buffer:async()=>Buffer.from('jpeg'),headers:{get:()=>null}});
 const result=await api.persistImageryBatch('carolina-beach',{[now]:{BAD:'https://images.example/bad.jpg',GOOD:'https://images.example/good.jpg'}},{[now]:6},5.6);
 assert.equal(result.failed,1);assert.equal(result.succeeded,1);assert.equal(result.patch[now].BAD,undefined);assert.ok(result.patch[now].GOOD);
});
test('non-HTTPS sources never trigger a network download',async()=>{
 let calls=0;const api=load(async()=>{calls++;});await assert.rejects(api.persistImage('http://images.example/unsafe.jpg','imagery/test.jpg'),/HTTPS/);assert.equal(calls,0);
});

const imageResponse = async () => ({ ok: true, buffer: async () => Buffer.from('jpeg'), headers: { get: () => 'image/jpeg' } });
const imageAt = time => ({ [time]: { CAM: 'https://images.example/current.jpg' } });

test('an offset camera timestamp archives flooding between bracketed observed gauge samples', async () => {
 const api = load(imageResponse);
 const time = '2026-10-14T11:23:17.000Z';
 const result = await api.persistImageryBatch('carolina-beach', imageAt(time), {
  '2026-10-14T11:28:05.000Z': 6.2,
  '2026-10-14T11:18:05.000Z': 6,
  'invalid': 9,
  '2026-10-14T11:20:00.000Z': NaN,
 }, 5.6);
 assert.equal(result.succeeded, 1);
 assert.ok(result.patch[time].CAM.startsWith('storage://'));
});

test('interpolation below flood stage does not archive merely because the later gauge sample exceeds stage', async () => {
 const api = load(imageResponse);
 const time = '2026-10-14T11:22:30.000Z';
 const result = await api.persistImageryBatch('carolina-beach', imageAt(time), {
  '2026-10-14T11:20:00.000Z': 5.4,
  '2026-10-14T11:30:00.000Z': 6,
 }, 5.6);
 assert.equal(result.attempted, 0);
 assert.equal(api.saved.length, 0);
});

test('interpolation above flood stage archives after the calculated crossing', async () => {
 const api = load(imageResponse);
 const time = '2026-10-14T11:25:00.000Z';
 const result = await api.persistImageryBatch('carolina-beach', imageAt(time), {
  '2026-10-14T11:20:00.000Z': 5.4,
  '2026-10-14T11:30:00.000Z': 6,
 }, 5.6);
 assert.equal(result.succeeded, 1);
});

test('missing, unbracketed or greater-than-30-minute observation gaps cannot infer flooding', async () => {
 const time = '2026-10-14T11:25:00.000Z';
 for (const levels of [
  {},
  { '2026-10-14T11:20:00.000Z': 8 },
  { '2026-10-14T11:30:00.000Z': 8 },
  { '2026-10-14T11:10:00.000Z': 8, '2026-10-14T11:40:01.000Z': 8 },
  { '2026-10-14T11:20:00.000Z': Infinity, '2026-10-14T11:30:00.000Z': 8 },
 ]) {
  const api = load(imageResponse);
  const result = await api.persistImageryBatch('carolina-beach', imageAt(time), levels, 5.6);
  assert.equal(result.attempted, 0);
  assert.equal(api.saved.length, 0);
 }
});

test('an exactly 30-minute bracket is allowed for image selection while forecast interpolation retains its own limit', async () => {
 const api = load(imageResponse);
 const time = '2026-10-14T11:25:00.000Z';
 const result = await api.persistImageryBatch('carolina-beach', imageAt(time), {
  '2026-10-14T11:10:00.000Z': 6,
  '2026-10-14T11:40:00.000Z': 6,
 }, 5.6);
 assert.equal(result.succeeded, 1);
 const { interpolate } = require('../lib/forecast/water');
 assert.equal(interpolate([
  { t: new Date('2026-10-14T11:10:00.000Z'), v: 6 },
  { t: new Date('2026-10-14T11:40:00.000Z'), v: 6 },
 ], new Date(time)), null);
});

test('exact observed threshold matches and hourly captures retain their established behavior', async () => {
 const exactTime = '2026-10-14T11:25:00.000Z';
 const exact = load(imageResponse);
 assert.equal((await exact.persistImageryBatch('carolina-beach', imageAt(exactTime), { [exactTime]: 5.6 }, 5.6)).succeeded, 1);
 const below = load(imageResponse);
 assert.equal((await below.persistImageryBatch('carolina-beach', imageAt(exactTime), { [exactTime]: 5.5 }, 5.6)).attempted, 0);
 const hourly = load(imageResponse);
 assert.equal((await hourly.persistImageryBatch('carolina-beach', imageAt('2026-10-14T11:06:00.000Z'), {}, 5.6)).succeeded, 1);
});
