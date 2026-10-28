import {createFormalAdminClient} from './formal-admin-workspace.prototype.js';
import {mountGenerationDetails} from './formal-generation-details.prototype.js';
const params=new URLSearchParams(location.search),sessionId=params.get('session');
const container=document.querySelector('#generationDetail');
const errors=await fetch('./shared/card-errors.json').then(r=>r.json());
const inspectionConfig=await fetch('./shared/generation-inspection.config.json').then(r=>r.json());
const client=createFormalAdminClient({errorMessages:errors});
const errorText=error=>errors[String(error.code||'NETWORK_ERROR').toUpperCase()]||errors.NETWORK_ERROR;
if(!sessionId){
  container.textContent='未指定会话，请返回管理端选择演绎记录，再打开生成详情。';
}else{
  try{
    const session=await client.request(`/sessions/${encodeURIComponent(sessionId)}`);
    document.querySelector('#sessionTitle').textContent=`${session.title || session.id} · ${session.id}`;
    const back=new URL(document.querySelector('#back').href);
    back.searchParams.set('session',sessionId);
    if(session.character_binding?.character_id)back.searchParams.set('character',session.character_binding.character_id);
    document.querySelector('#back').href=back.href;
    await mountGenerationDetails({container,client,sessionId,errorText,expanded:false,inspectionConfig,initialFloorId:params.get('floor'),onFloorChange(floorId){
      const url=new URL(location.href);url.searchParams.set('floor',floorId);history.replaceState(null,'',url);
    }});
  }catch(error){container.textContent=errorText(error);container.setAttribute('role','alert');}
}
