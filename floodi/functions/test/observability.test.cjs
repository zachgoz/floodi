const {test}=require('node:test');const assert=require('node:assert/strict');
const {safeError}=require('../lib/utils/observability');
test('preserves actionable Vertex status and API message without request secrets',()=>{
 const error=Object.assign(new Error('generic'),{code:'PERMISSION_DENIED',response:{status:403,data:{error:{message:'Vertex denied model access to person@example.com at https://vertex.example/path?token=secret',status:'PERMISSION_DENIED'}}},config:{headers:{Authorization:'Bearer private-secret'},data:'full forecast'}});
 const safe=safeError(error);assert.equal(safe.httpStatus,403);assert.equal(safe.apiStatus,'PERMISSION_DENIED');assert.match(safe.message,/Vertex denied model access/);
 assert.equal(JSON.stringify(safe).includes('private-secret'),false);assert.equal(JSON.stringify(safe).includes('full forecast'),false);assert.equal(safe.message.includes('person@example.com'),false);assert.equal(safe.message.includes('https://'),false);
});
test('redacts credential assignments from custom transport error messages',()=>{
 const safe=safeError(new Error('request failed token=abc123 api_key="supersecret" Authorization: Bearer anothersecret'));
 assert.equal(JSON.stringify(safe).includes('abc123'),false);assert.equal(JSON.stringify(safe).includes('supersecret'),false);assert.equal(JSON.stringify(safe).includes('anothersecret'),false);
});
test('retains a bounded sanitized database cause and partial write counts',()=>{
 const error=Object.assign(new Error('Observation daily bucket write failed'),{cause:Object.assign(new Error('Firestore permission denied for token=private-secret'),{code:7}),progress:{daysWritten:1,recordsWritten:400,rejectedRecords:0,unsafe:'not retained'}});
 const safe=safeError(error);assert.equal(safe.causeCode,'7');assert.match(safe.causeMessage,/Firestore permission denied/);assert.equal(safe.recordsWritten,400);assert.equal(JSON.stringify(safe).includes('private-secret'),false);assert.equal(JSON.stringify(safe).includes('not retained'),false);
});
test('per-source success stamps survive other sources succeeding while NOAA fails',async()=>{
 const {recordJobOutcome}=require('../lib/utils/observability');
 let document={sourceLastSuccessfulAt:{noaa:'2026-10-13T12:00:00.000Z'},lastSuccessfulAt:'2026-10-13T12:00:00.000Z'};
 const db={doc:()=>({set:async(patch)=>{document={...document,...patch,sourceLastSuccessfulAt:{...document.sourceLastSuccessfulAt,...patch.sourceLastSuccessfulAt}};}})};
 await recordJobOutcome(db,'syncPredictions','carolina-beach',{status:'partial',sources:{noaa:{status:'failed',count:0},weather:{status:'ok',count:12}}});
 assert.equal(document.sourceLastSuccessfulAt.noaa,'2026-10-13T12:00:00.000Z');assert.ok(document.sourceLastSuccessfulAt.weather);
 assert.equal(document.sourceLastSuccessfulAt.weather,document.completedAt);
 await recordJobOutcome(db,'syncPredictions','carolina-beach',{status:'failed',sources:{noaa:{status:'empty',count:0},weather:{status:'failed',count:0}}});
 assert.equal(document.sourceLastSuccessfulAt.noaa,'2026-10-13T12:00:00.000Z');
});
