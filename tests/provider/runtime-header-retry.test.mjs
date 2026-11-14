import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { api } from './helpers.mjs';
import { ProjectTokenError } from '../../src/project-token.ts';
const options={model:'GLM-5.3',reasoningLevel:'high',permissionMode:'full',permissionScope:'full',approvalReviewer:null,permissionEscalation:null};
async function wait(predicate){for(let i=0;i<500;i++){if(predicate())return;await delay(5);}throw Error('fixture wait timeout');}
for(const kind of ['snapshot','scope','transient','login','unsupported','owner','transient-login','preframe','preframe-transient','preframe-login','preframe-wrong','preframe-fast']) test(`runtime header ${kind}: structured terminal classification survives generic native error without input resends`,async()=>{
 const cwd=realpathSync(mkdtempSync(join(tmpdir(),'zcode-header-retry-'))),out=[],observed=[];let child,fail=false,headerRequests=0;
 const auth=new api.ReadOnlyAuth('synthetic');auth.read=()=>({apiKey:'SYNTHETIC_ONLY'});
 auth.runtimeHeaders=async()=>{headerRequests++;if(fail&&['preframe-transient','preframe-login'].includes(kind)){await delay(60);throw new ProjectTokenError(kind==='preframe-login'?'project_token_login_failed':'project_token_request_failed',kind==='preframe-transient');}if(fail&&kind==='transient-login')throw new ProjectTokenError(headerRequests===1?'project_token_request_failed':'project_token_login_failed',headerRequests===1);if(fail&&kind==='transient')throw new ProjectTokenError('project_token_request_failed',true);if(fail&&kind==='login')throw new ProjectTokenError('project_token_login_failed');if(fail&&kind==='unsupported')throw new api.AuthError('unsupported-mode');return{headersApplied:true};};
 const bridge=api.createZCodeBridge({prepare:async()=>({auth,launch:{executable:process.execPath,args:[resolve('tests/provider/fake-v4.mjs'),'v4'],cwd,env:api.childEnvironment(process.env,{})},configure:async value=>{child=value;}}),
  models:async()=>{if(fail&&kind==='preframe-fast')throw Error('Catalogue root changed or runtime/config scope changed; retry after reconciliation');if(fail&&['preframe','preframe-wrong','preframe-fast'].includes(kind)){if(kind==='preframe')await wait(()=>out.some(message=>message.params?.deltas?.some(delta=>delta.kind==='turn.open')));else await delay(60);throw Error('Catalogue root changed or runtime/config scope changed; retry after reconciliation');}if(fail&&['snapshot','scope'].includes(kind))throw Error('Catalogue root changed or runtime/config scope changed; retry after reconciliation');if(fail&&kind==='owner')throw Error('Catalogue root changed or services closed; retry on current root');return{models:[{model:'GLM-5.3'}]};},
  validateSelection:async()=>kind==='snapshot'?{model:'GLM-5.3',reasoning:'high',availableModels:['GLM-5.3']}:undefined,health:async()=>({}),installation:async()=>({}),observe:event=>observed.push(event)},message=>out.push(message));
 let request=0;
 const call=async(method,params)=>{const id=++request;bridge.handleLine(JSON.stringify({jsonrpc:'2.0',id,method,params}));await wait(()=>out.some(message=>message.id===id));const reply=out.find(message=>message.id===id);assert.equal(reply.error,undefined,JSON.stringify(reply));return reply.result;};
 try{
  const {providerThreadId}=await call('thread/start',{threadId:'header-retry',cwd,instructionMode:'append',options});
  fail=kind.startsWith('preframe');
  await call('turn/start',{threadId:'header-retry',providerThreadId,clientRequestId:'creq_2222222222',options,input:[{type:'text',text:kind==='preframe-wrong'?'/auth-before-wrong':kind==='preframe-fast'?'/auth-before-terminal':kind.startsWith('preframe')?'/auth-before-frame':'/wait-for-interrupt'}]});
  fail=true;if(!kind.startsWith('preframe'))await child.request('auth-bad',{});await wait(()=>observed.some(event=>event.event==='runtime-headers-result'));
  if(kind==='preframe-wrong'){const evidence=observed.find(event=>event.event==='runtime-headers-error');assert.equal(evidence.requestTurnId,null);assert.equal(evidence.capturedCommand,true);assert.equal(out.flatMap(message=>message.params?.deltas??[]).some(delta=>['internal','connection-failed'].includes(delta.errorInfo?.category)),false);return;}
  if(kind==='snapshot'){assert.equal(headerRequests,1);assert.equal(observed.some(event=>event.event==='runtime-headers-error'),false);}
  if(kind==='transient-login'){await child.request('auth-bad',{});await wait(()=>observed.filter(event=>event.event==='runtime-headers-result').length===2);}
  if(kind!=='preframe-fast')await child.request('fixture/fail',{});await wait(()=>out.some(message=>message.params?.deltas?.some(delta=>delta.kind==='turn.boundary')));
  const deltas=out.flatMap(message=>message.params?.deltas??[]),terminal=deltas.filter(delta=>delta.kind==='provider.error').at(-1);
  assert.equal(terminal.errorInfo.category,['scope','preframe','preframe-fast'].includes(kind)?'internal':['transient','preframe-transient'].includes(kind)?'connection-failed':'unknown');
  assert.equal(deltas.findIndex(delta=>delta===terminal)<deltas.findIndex(delta=>delta.kind==='turn.boundary'),true);
  assert.equal(observed.filter(event=>event.event==='turn-requested-selection').length,1);
  assert.equal(JSON.stringify(out).includes('SYNTHETIC_ONLY'),false);
  if(kind==='preframe'){const evidence=observed.find(event=>event.event==='runtime-headers-error');assert.equal(evidence.capturedTurn,false);assert.equal(evidence.capturedCommand,true);assert.ok(evidence.requestTurnId);}
  fail=false;const before=out.length;
  await call('turn/start',{threadId:'header-retry',providerThreadId,clientRequestId:'creq_3333333333',options,input:[{type:'text',text:'/wait-for-interrupt'}]});
  await child.request('fixture/fail',{});await wait(()=>out.slice(before).some(message=>message.params?.deltas?.some(delta=>delta.kind==='turn.boundary')));
  const next=out.slice(before).flatMap(message=>message.params?.deltas??[]).filter(delta=>delta.kind==='provider.error').at(-1);
  assert.equal(next.errorInfo.category,'unknown');
 }finally{await bridge.close();rmSync(cwd,{recursive:true});}
});
test('lifecycle keeps current-turn retry evidence when a stale earlier request succeeds',()=>{
 const messages=[],lifecycle=new api.SessionLifecycle('thr_2222222222','session1','epoch1',1,()=>{},message=>messages.push(message),async()=>0);
 const failure={kind:'provider.error',category:'internal',errorInfo:{category:'internal',providerCode:'catalogue-scope-changed',httpStatusCode:null},message:'Temporary request preparation failure.'};
 lifecycle.requestFailure('current',failure,1,'session1');
 lifecycle.requestFailure('previous',undefined,1,'session1');
 const rows=[{rowId:1,kind:'turnHeader',turnId:'current',state:'failed',sourceCommandId:'command-current'}];
 const state={logEpoch:'epoch1',rows:{window:rows,totalCount:1,firstRowId:1},control:{phase:'error',activeWorks:[],lastError:{code:'model_request_failed'}},backgroundWorks:[],pendingInteractions:[]};
 const correlation=new api.CommandCorrelation();correlation.begin('command-current','creq_2222222222',1,100);correlation.authoritative('command-current',1,'inputAccepted','current');
 lifecycle.project(state,1,'session1',correlation);
 assert.equal(messages.flatMap(message=>message.params?.deltas??[]).find(delta=>delta.kind==='provider.error').errorInfo.category,'internal');
});
