const {test}=require('node:test');const assert=require('node:assert/strict');
const {parseFimanPayload}=require('../lib/etl/fiman');
function payload(camera){return {features:[{properties:{platform_id:'SUNNYD_CB_03',parameters:[{id:'FIMAN (observed)',name:'FIMAN (observed)',units:'ft',www:{description:'https://fiman.nc.gov/gauge?id=30046',uom_ts_suffix:'ft NAVD88'},observations:{times:['2026-10-14T11:00:00'],values:[2],quality:[0]}},...camera]}}]};}
test('malformed camera arrays, values and timestamps cannot reject otherwise valid parsed data',()=>{
 const result=parseFimanPayload(payload([{id:'Camera',observations:{times:'bad',values:null}},{id:'Camera',observations:{times:['bad-time','2026-10-14T11:00:00','2026-10-14T11:06:00'],values:['https://example.test/CAM.jpg',null,'https://example.test/CAM.jpg']}}]),'SUNNYD_CB_03',2.75);
 assert.deepEqual(result.imagery,{'2026-10-14T11:06:00.000Z':{CAM:'https://example.test/CAM.jpg'}});
 assert.equal(result.waterLevels['2026-10-14T11:00:00.000Z'],4.75);
 assert.doesNotThrow(()=>JSON.stringify(result));
});

function isolatedFiman(fetch) {
 const Module=require('node:module');const path=require.resolve('../lib/etl/fiman');
 const warnings=[];const original=Module._load;delete require.cache[path];
 Module._load=function(request,...args){
  if(request==='firebase-functions/logger')return {warn:(message,details)=>warnings.push({message,details})};
  if(request==='node-fetch'&&fetch)return fetch;
  return original.call(this,request,...args);
 };
 try{return {...require(path),warnings};}finally{Module._load=original;}
}
test('water-only parsing skips unused historical cameras while preserving the exact validated gauge measurements',()=>{
 const data=payload([{id:'Camera',observations:{times:[],values:[]}},{id:'Camera',observations:{times:'bad',values:null}}]);
 const live=isolatedFiman();const expected=live.parseFimanPayload(data,'SUNNYD_CB_03',2.75);
 assert.equal(live.warnings.length,1);assert.equal(live.warnings[0].details.count,2);
 const historical=isolatedFiman();const result=historical.parseFimanPayload(data,'SUNNYD_CB_03',2.75,false,{includeImagery:false});
 assert.deepEqual(result.waterLevels,expected.waterLevels);assert.deepEqual(result.imagery,{});assert.equal(historical.warnings.length,0);
});
test('live parsing retains valid camera imagery and warnings for malformed records by default',()=>{
 const api=isolatedFiman();const result=api.parseFimanPayload(payload([{id:'Camera',observations:{times:['invalid','2026-10-14T11:06:00Z'],values:['https://example.test/CAM.jpg','https://example.test/CAM.jpg']}}]),'SUNNYD_CB_03',2.75);
 assert.equal(result.imagery['2026-10-14T11:06:00.000Z'].CAM,'https://example.test/CAM.jpg');assert.equal(api.warnings.length,1);
 assert.equal(result.waterLevels['2026-10-14T11:00:00.000Z'],4.75);
});
test('water-only retrieval forwards the opt-in through fetch without weakening source references or live defaults',async()=>{
 const api=isolatedFiman(async()=>({ok:true,json:async()=>payload([{id:'Camera',observations:{times:'invalid'}}])}));
 const result=await api.fetchFimanData('SUNNYD_CB_03',new Date('2026-10-14T10:00Z'),new Date('2026-10-14T12:00Z'),2.75,false,{includeImagery:false});
 assert.equal(result.waterLevels['2026-10-14T11:00:00.000Z'],4.75);assert.deepEqual(result.imagery,{});assert.equal(api.warnings.length,0);
});
