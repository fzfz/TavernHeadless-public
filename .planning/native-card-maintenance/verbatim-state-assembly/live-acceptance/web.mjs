import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const root=process.cwd();const out=resolve(root,'.planning/native-card-maintenance/verbatim-state-assembly/live-acceptance');
const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try {
 const path=new URL(req.url,'http://localhost').pathname;
 if(path==='/config/application.json'){
  const current=JSON.parse(await readFile(out+'/server.json','utf8'));
  res.setHeader('content-type','application/json');res.end(JSON.stringify({apiBaseUrl:current.address,adminBaseUrl:current.address}));return;
 }
 const file=path==='/'?'/index.html':path;
 const abs=resolve(root,'apps/user-web/dist','.'+file);if(!abs.startsWith(resolve(root,'apps/user-web/dist')+'/'))throw Error('Invalid path');
 res.setHeader('content-type',mime[extname(abs)]||'application/octet-stream');res.end(await readFile(abs));
 }catch{res.statusCode=404;res.end('File not found');}});
server.listen(0,'127.0.0.1',async()=>{const address='http://127.0.0.1:'+server.address().port;await writeFile(out+'/web-server.json',JSON.stringify({address,mode:'static-with-direct-cross-origin-api'},null,2));console.log(address);});
