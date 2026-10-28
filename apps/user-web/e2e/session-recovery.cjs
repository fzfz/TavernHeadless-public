const {chromium,expect}=require('playwright/test');
const fs=require('node:fs/promises');
const assert=require('node:assert/strict');
const base=process.env.USER_WEB_URL||'http://127.0.0.1:4190';
const output=process.env.USER_WEB_EVIDENCE||'/tmp/tavern-user-web-portal-evidence';
const report={cases:[]};
(async()=>{await fs.mkdir(output,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:false});const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
async function call(method,path,data){const r=await context.request.fetch(base+'/api'+path,{method,data,headers:{Origin:base}});assert.ok(r.ok(),`${path}: ${r.status()} ${await r.text()}`);return r.json();}
async function check(name,fn){await fn();report.cases.push({name,status:'passed'});console.log('PASS '+name);}
try{const credentials={name:'会话恢复验收',email:`session-recovery-${Date.now()}@example.test`,password:'Session-Recovery-2026!'};await call('POST','/auth/register',credentials);await call('POST','/auth/login',credentials);const role=(await call('GET','/public/roles?keyword='+encodeURIComponent('旧城夜话'))).data[0];let sessionId;
await check('P13 无人格时创建并返回选择；创建提交后503按原操作核对',async()=>{
 await page.goto(base+'/#start/'+role.id);await page.getByRole('button',{name:'创建演绎人格',exact:true}).click();await page.getByLabel('人格姓名',{exact:true}).fill('江宁');await page.getByLabel('完整人设描述',{exact:true}).fill('江宁，女性，27岁。旧城信件整理员，耐心谨慎。');await page.getByRole('button',{name:'保存人格',exact:true}).click();await expect(page.getByRole('radio',{name:/江宁/})).toBeChecked();let writes=0;
 await page.route('**/api/public/roles/*/sessions',async route=>{writes++;await route.fetch();await route.fulfill({status:503,json:{error:{code:'proxy_unavailable',message:'连接暂时不可用'}}});});await page.getByRole('button',{name:'开始演绎',exact:true}).click();await expect(page.getByRole('button',{name:'核对创建结果',exact:true})).toBeVisible();await page.unrouteAll({behavior:'wait'});await page.reload();await page.getByRole('button',{name:'核对创建结果',exact:true}).click();await expect(page).toHaveURL(/#chat\//);sessionId=new URL(page.url()).hash.slice(6).split('?')[0];assert.equal(writes,1);assert.equal((await call('GET','/sessions')).meta.total,1);
});
await check('P19 标题提交丢响应、关闭、刷新后核对已保存标题',async()=>{
 await page.getByRole('button',{name:'演绎设置',exact:true}).click();await page.getByLabel('演绎标题',{exact:true}).fill('信件恢复验收');await page.route('**/api/sessions/'+sessionId,async route=>{if(route.request().method()==='PATCH'){await route.fetch();await route.abort('failed');}else await route.continue();});await page.getByRole('button',{name:'保存名称',exact:true}).click();await expect(page.getByRole('button',{name:'核对保存结果',exact:true})).toBeVisible();await page.unrouteAll({behavior:'wait'});await page.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('button',{name:'保留草稿并离开',exact:true}).click();await page.reload();await page.getByRole('button',{name:'演绎设置',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('heading',{name:'信件恢复验收',exact:true})).toBeVisible();
});
await check('P19 刷新恢复草稿后显示服务端标题变化，保留草稿再提交',async()=>{
 await page.getByRole('button',{name:'演绎设置',exact:true}).click();await page.getByLabel('演绎标题',{exact:true}).fill('本标签页草稿');await page.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('button',{name:'保留草稿并离开',exact:true}).click();await call('PATCH','/sessions/'+sessionId,{title:'其他标签页保存的标题'});await page.reload();await page.getByRole('button',{name:'演绎设置',exact:true}).click();await expect(page.getByText('其他标签页保存的标题',{exact:true}).last()).toBeVisible();await expect(page.getByRole('button',{name:'保存名称',exact:true})).toBeDisabled();await page.getByRole('button',{name:'继续使用草稿',exact:true}).click();await page.getByRole('button',{name:'保存名称',exact:true}).click();await expect(page.getByRole('heading',{name:'本标签页草稿',exact:true})).toBeVisible();
});
await page.screenshot({path:output+'/390-session-recovery.png',fullPage:true});
}catch(error){report.failure=String(error.stack||error);await page.screenshot({path:output+'/session-recovery-failure.png',fullPage:true});throw error;}finally{await fs.writeFile(output+'/session-recovery.json',JSON.stringify(report,null,2));await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
