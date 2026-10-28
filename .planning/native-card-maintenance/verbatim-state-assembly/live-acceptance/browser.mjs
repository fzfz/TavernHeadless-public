import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
const out=resolve('.planning/native-card-maintenance/verbatim-state-assembly/live-acceptance');
const web=JSON.parse(await readFile(out+'/web-server.json','utf8'));
const cases=JSON.parse(await readFile(out+'/cases.json','utf8'));
const dir=await mkdtemp(resolve('.tmp/state-live/chrome-'));
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=0','--user-data-dir='+dir,'--no-first-run','--no-default-browser-check','--window-size=1280,1000','about:blank'],{stdio:['ignore','ignore','pipe']});
let stderr='';chrome.stderr.on('data',b=>stderr+=b);
let endpoint;
for(let i=0;i<40;i++){const m=stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){endpoint=m[1];break;}await new Promise(r=>setTimeout(r,250));}
if(!endpoint)throw Error('Chrome debugging endpoint missing');
const socket=new WebSocket(endpoint);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
let id=0;const pending=new Map();const errors=[];
socket.onmessage=e=>{const d=JSON.parse(e.data);if(d.id){const p=pending.get(d.id);pending.delete(d.id);if(d.error)p.reject(Error(JSON.stringify(d.error)));else p.resolve(d.result);}else if(d.method==='Runtime.exceptionThrown')errors.push(d.params);};
const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});socket.send(JSON.stringify({id:n,method,params,...(sessionId?{sessionId}:{})}));});
try{
 for(const key of process.argv.slice(2)){
  const target=await send('Target.createTarget',{url:'about:blank'});
  const attach=await send('Target.attachToTarget',{targetId:target.targetId,flatten:true});const sid=attach.sessionId;
  await send('Runtime.enable',{},sid);await send('Page.enable',{},sid);
  const url=web.address+'/?sessionId='+cases[key].sessionId;
  await send('Page.navigate',{url},sid);
  await new Promise(r=>setTimeout(r,4000));
  const d=await send('Runtime.evaluate',{expression:`JSON.stringify({url:location.href,text:document.body.innerText,shadows:(()=>{const result=[];const visit=root=>{for(const element of root.querySelectorAll('*')){if(element.shadowRoot){result.push({host:element.tagName,text:Array.from(element.shadowRoot.children).filter(e=>!['STYLE','SCRIPT'].includes(e.tagName)).map(e=>e.innerText||'').join('\\n'),html:element.shadowRoot.innerHTML});visit(element.shadowRoot);}}};visit(document);return result;})(),frames:Array.from(document.querySelectorAll('iframe')).map(f=>{try{return {title:f.title,text:f.contentDocument?.body?.innerText,html:f.contentDocument?.body?.innerHTML}}catch(e){return {error:String(e)}}})})`,returnByValue:true},sid);
  await writeFile(out+'/'+key+'-page.json',JSON.stringify({dom:JSON.parse(d.result.value),errors},null,2));
  const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sid);
  await writeFile(out+'/'+key+'-page.png',Buffer.from(shot.data,'base64'));
  console.log(key,'DOM and screenshot saved');
  await send('Target.closeTarget',{targetId:target.targetId});
 }
}finally{await send('Browser.close');socket.close();}
