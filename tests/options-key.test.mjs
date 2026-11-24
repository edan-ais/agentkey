import test from 'node:test';import assert from 'node:assert/strict';import{agentkey,encodeApiKey}from'../packages/sdk/auto.mjs';import{mkdtempSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';
const key=encodeApiKey({agent_id:'11111111-1111-4111-8111-111111111111',sign_in:{url:'https://synthetic.example/token',email:'synthetic@example.test',password:'synthetic-test-only',apikey:'synthetic-public-key'}});
async function run(options,check){const cwd=mkdtempSync(join(tmpdir(),'ak-options-contract-'));let calls=0;try{await check(()=>agentkey({cwd,env:{},fetchImpl:()=>{calls++;throw Error('network_forbidden')},...options}));assert.equal(calls,0)}finally{rmSync(cwd,{recursive:true,force:true})}}
test('options-only declared apiKey selects cloud without needing env',()=>run({apiKey:key},async f=>{assert.equal((await f()).mode,'cloud')}));
test('explicit cloud accepts options-only apiKey',()=>run({mode:'cloud',apiKey:key},async f=>{assert.equal((await f()).mode,'cloud')}));
test('env-only key still selects cloud',()=>run({env:{AGENTKEY_API_KEY:key}},async f=>{assert.equal((await f()).mode,'cloud')}));
test('options overrides invalid env key',()=>run({apiKey:key,env:{AGENTKEY_API_KEY:'bad'}},async f=>{assert.equal((await f()).mode,'cloud')}));
test('invalid options wins over valid env and is rejected',()=>run({apiKey:'bad',env:{AGENTKEY_API_KEY:key}},async f=>{await assert.rejects(f,{code:'invalid_api_key'})}));
test('explicit cloud still requires a key',()=>run({mode:'cloud'},async f=>{await assert.rejects(f,{code:'missing_api_key'})}));
test('invalid option alone reaches proper invalid-key rejection',()=>run({apiKey:'bad'},async f=>{await assert.rejects(f,{code:'invalid_api_key'})}));
test('explicit local does not switch to cloud from options key',()=>run({mode:'local',apiKey:key},async f=>{assert.equal((await f()).mode,'local')}));
