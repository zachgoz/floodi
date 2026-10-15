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
