import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
const out=resolve('.planning/native-card-maintenance/verbatim-state-assembly/deepseek-acceptance');
const web=JSON.parse(await readFile(out+'/web-server.json','utf8'));
const cases=JSON.parse(await readFile(out+'/cases.json','utf8'));
const dir=await mkdtemp(resolve('.tmp/state-deepseek/chrome-'));
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=0','--user-data-dir='+dir,'--no-first-run','--no-default-browser-check','--window-size=1280,1000','about:blank'],{stdio:['ignore','ignore','pipe']});
let stderr='';chrome.stderr.on('data',b=>stderr+=b);
let endpoint;
for(let i=0;i<40;i++){const m=stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){endpoint=m[1];break;}await new Promise(r=>setTimeout(r,250));}
if(!endpoint)throw Error('Chrome debugging endpoint missing');
const socket=new WebSocket(endpoint);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
let id=0;const pending=new Map();const errorsBySession=new Map();const responsesBySession=new Map();
socket.onmessage=e=>{const d=JSON.parse(e.data);if(d.id){const p=pending.get(d.id);pending.delete(d.id);if(d.error)p.reject(Error(JSON.stringify(d.error)));else p.resolve(d.result);}else if(d.method==='Runtime.exceptionThrown'){const errors=errorsBySession.get(d.sessionId)||[];errors.push(d.params);errorsBySession.set(d.sessionId,errors);}else if(d.method==='Network.responseReceived'){const responses=responsesBySession.get(d.sessionId)||[];responses.push({url:d.params.response.url,status:d.params.response.status,requestId:d.params.requestId});responsesBySession.set(d.sessionId,responses);}};
const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});socket.send(JSON.stringify({id:n,method,params,...(sessionId?{sessionId}:{})}));});
try{
 for(const key of process.argv.slice(2)){
  const target=await send('Target.createTarget',{url:'about:blank'});
  const attach=await send('Target.attachToTarget',{targetId:target.targetId,flatten:true});const sid=attach.sessionId;
  await send('Runtime.enable',{},sid);await send('Page.enable',{},sid);await send('Network.enable',{},sid);
  const expectedSnapshotId=cases[key].lastState.snapshotId;
  const url=web.address+'/?sessionId='+cases[key].sessionId+'&snapshotId='+expectedSnapshotId;
  await send('Page.navigate',{url},sid);
  let ready=false;
  for(let attempt=0;attempt<60;attempt++){const result=await send('Runtime.evaluate',{expression:"Array.from(document.querySelectorAll('*')).some(e=>e.shadowRoot&&e.shadowRoot.querySelector('[data-text],.linxi-page'))",returnByValue:true},sid);const loaded=(responsesBySession.get(sid)||[]).some(r=>r.url.includes('/role-view')&&r.status===200);if(result.result.value&&loaded){ready=true;break;}await new Promise(r=>setTimeout(r,500));}
  if(!ready)throw Error(key+': role page did not finish loading');
  await new Promise(r=>setTimeout(r,1500));
  const responseEvidence=[];for(const response of responsesBySession.get(sid)||[]){if(!response.url.includes('/role-view'))continue;const body=await send('Network.getResponseBody',{requestId:response.requestId},sid);responseEvidence.push({url:response.url,status:response.status,data:JSON.parse(body.body)});}
  const d=await send('Runtime.evaluate',{expression:`JSON.stringify({url:location.href,text:document.body.innerText,shadows:(()=>{const result=[];const visit=root=>{for(const element of root.querySelectorAll('*')){if(element.shadowRoot){result.push({host:element.tagName,text:Array.from(element.shadowRoot.children).filter(e=>!['STYLE','SCRIPT'].includes(e.tagName)).map(e=>e.innerText||'').join('\\n'),html:element.shadowRoot.innerHTML});visit(element.shadowRoot);}}};visit(document);return result;})(),frames:Array.from(document.querySelectorAll('iframe')).map(f=>{try{return {title:f.title,text:f.contentDocument?.body?.innerText,html:f.contentDocument?.body?.innerHTML}}catch(e){return {error:String(e)}}})})`,returnByValue:true},sid);
  await writeFile(out+'/'+key+'-page.json',JSON.stringify({expectedSnapshotId,responseEvidence,dom:JSON.parse(d.result.value),errors:errorsBySession.get(sid)||[],network:(responsesBySession.get(sid)||[]).map(({url,status})=>({url,status}))},null,2));
  const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sid);
  await writeFile(out+'/'+key+'-page.png',Buffer.from(shot.data,'base64'));
  console.log(key,'loaded role DOM and screenshot saved');
  await send('Target.closeTarget',{targetId:target.targetId});
 }
}finally{await send('Browser.close');socket.close();}
