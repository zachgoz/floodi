const {test}=require('node:test');const assert=require('node:assert/strict');const Module=require('node:module');
test('historical model collection explicitly requests water-only FiMAN data for every weekly interval',async()=>{
 const path=require.resolve('../lib/forecast/sources');delete require.cache[path];
 const calls=[];const original=Module._load;
 Module._load=function(request,parent,...args){
  if(parent?.filename===path){
   if(request==='../etl/fiman')return {fetchFimanData:async(...args)=>{calls.push(args);return {waterLevels:{},imagery:{}};}};
   if(request==='../etl/noaa')return {fetchNoaaPredictions:async()=>({})};
   if(request==='../utils/providerRequest')return {providerJson:async()=>({utc_offset_seconds:0,hourly:{time:[]},hourly_units:{wind_speed_10m:'mp/h',wind_direction_10m:'°',precipitation:'inch',pressure_msl:'hPa'}})};
  }
  return original.call(this,request,parent,...args);
 };
 let sources;try{sources=require(path);}finally{Module._load=original;}
 const result=await sources.collectHistory(new Date('2026-10-01T00:00:00Z'),new Date('2026-10-15T00:00:00Z'));
 assert.equal(calls.length,2);
 for(const args of calls){assert.equal(args[0],sources.SITE.retrievalPlatform);assert.equal(args[3],sources.SITE.offsetFt);assert.equal(args[4],false);assert.deepEqual(args[5],{includeImagery:false});}
 assert.deepEqual(result.failures,[]);assert.deepEqual(result.history,[]);assert.equal(result.metadata.sensor,'30046');
});
