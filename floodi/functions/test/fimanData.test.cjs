const {test}=require('node:test');const assert=require('node:assert/strict');
const {parseFimanPayload}=require('../lib/etl/fiman');
function payload(camera){return {features:[{properties:{platform_id:'SUNNYD_CB_03',parameters:[{id:'FIMAN (observed)',name:'FIMAN (observed)',units:'ft',www:{description:'https://fiman.nc.gov/gauge?id=30046',uom_ts_suffix:'ft NAVD88'},observations:{times:['2026-10-14T11:00:00'],values:[2],quality:[0]}},...camera]}}]};}
test('malformed camera arrays, values and timestamps cannot reject otherwise valid parsed data',()=>{
 const result=parseFimanPayload(payload([{id:'Camera',observations:{times:'bad',values:null}},{id:'Camera',observations:{times:['bad-time','2026-10-14T11:00:00','2026-10-14T11:06:00'],values:['https://example.test/CAM.jpg',null,'https://example.test/CAM.jpg']}}]),'SUNNYD_CB_03',2.75);
 assert.deepEqual(result.imagery,{'2026-10-14T11:06:00.000Z':{CAM:'https://example.test/CAM.jpg'}});
 assert.equal(result.waterLevels['2026-10-14T11:00:00.000Z'],4.75);
 assert.doesNotThrow(()=>JSON.stringify(result));
});
