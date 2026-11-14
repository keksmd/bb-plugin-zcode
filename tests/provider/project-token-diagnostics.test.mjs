import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
for(const scenario of ['http401','http429','http503','request-reset','response-reset','response-aborted','unknown-code','invalid-json','http401-aborted','missing-ca'])test(`safe token transport diagnostics: ${scenario}`,()=>{
 const source=`import https from 'node:https';import {EventEmitter} from 'node:events';import {syncBuiltinESMExports} from 'node:module';
 const scenario=${JSON.stringify(scenario)};let calls=0;
 https.request=(url,options,callback)=>{calls++;const req=new EventEmitter();req.end=()=>queueMicrotask(()=>{
  if(scenario==='request-reset'||scenario==='unknown-code'){req.emit('error',Object.assign(Error('PRIVATE_MESSAGE'),{code:scenario==='unknown-code'?'PRIVATE_CODE':'ECONNRESET',headers:{Authorization:'PRIVATE_TOKEN'}}));return;}
  const res=new EventEmitter();res.statusCode=scenario.startsWith('http')?Number(scenario.slice(4).split('-')[0]):200;res.headers={};callback(res);
  if(scenario==='response-reset')res.emit('error',Object.assign(Error('PRIVATE_RESPONSE'),{code:'ECONNRESET'}));
  else if(scenario==='response-aborted'||scenario==='http401-aborted')res.emit('aborted');
  else {res.emit('data',Buffer.from('PRIVATE_INVALID_JSON'));res.emit('end');}req.emit('close');});return req;};syncBuiltinESMExports();
 const {tokenRequest}=await import(${JSON.stringify(new URL('../../src/project-token.ts',import.meta.url).href)});
 try{await tokenRequest(scenario==='missing-ca'?{ZCODE_AGENT_CA_CERT:'/missing/PRIVATE_CA'}:{})('/api/biz/v1/organization/PRIVATE_ORG/projects/PRIVATE_PROJECT/api_keys/PRIVATE_KEY/access_tokens','POST',{Authorization:'PRIVATE_TOKEN'},{secret:'PRIVATE_BODY'});process.exitCode=1;}
 catch(error){process.stdout.write(JSON.stringify({code:error.code,transient:error.transient,diagnostics:error.diagnostics,calls}));}`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
 const failure=JSON.parse(result.stdout);assert.equal(failure.calls,scenario==='missing-ca'?0:1);assert.equal(failure.diagnostics.method,'POST');
 assert.equal(failure.diagnostics.path,'/api/biz/v1/organization/:organizationId/projects/:projectId/api_keys/:apiKeyId/access_tokens');
 assert.equal(JSON.stringify(failure).includes('PRIVATE'),false);
 if(scenario.startsWith('http')){assert.equal(failure.diagnostics.status,Number(scenario.slice(4).split('-')[0]));assert.equal(failure.transient,!scenario.startsWith('http401'));}
 if(scenario==='missing-ca'){assert.equal(failure.transient,false);assert.equal(failure.diagnostics.networkCode,'ENOENT');}
 if(scenario==='http401-aborted'){assert.equal(failure.code,'project_token_login_failed');assert.equal(failure.transient,false);}
 if(scenario.includes('reset')){assert.equal(failure.diagnostics.networkCode,'ECONNRESET');assert.equal(failure.transient,true);}
 if(scenario==='response-aborted'){assert.equal(failure.diagnostics.networkCode,'ERR_STREAM_PREMATURE_CLOSE');assert.equal(failure.transient,true);}
 if(scenario==='unknown-code')assert.equal(failure.diagnostics.networkCode,undefined);
 if(scenario==='invalid-json'){assert.equal(failure.code,'project_token_invalid_response');assert.equal(failure.diagnostics.status,200);assert.equal(failure.transient,false);}
});
