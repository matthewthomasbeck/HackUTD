// curl -s https://integrate.api.nvidia.com/v1/chat/completions -H "Authorization: Bearer $NVIDIA_API_KEY" -H "Content-Type: application/json" -d '{"model":"nvidia/nemotron-3-nano-30b-a3b","messages":[{"role":"user","content":"Say OK"}],"max_tokens":16,"stream":false}'
import { mkdirSync,writeFileSync } from 'node:fs';
import OpenAI from 'openai';
import { loadConfig } from '../src/config.js';
import { parse } from '../src/llm/parse.js';
import { geo } from '../src/geo.js';
const cfg=loadConfig();
if(!cfg.apiKey) {console.log(JSON.stringify({status:'skipped',reason:'NVIDIA_API_KEY is not configured; no model support or latency has been verified'}));}
else {
  const client=new OpenAI({apiKey:cfg.apiKey,baseURL:cfg.baseURL,timeout:30000,maxRetries:0});
  const properties=Object.fromEntries(['from_lat','from_lon','to_lat','to_lon'].map(k=>[k,{type:'number'}]));
  const tool={type:'function' as const,function:{name:'compute_bearing',description:'Compute distance in meters and compass bearing.',parameters:{type:'object',properties:{...properties,reason:{type:'string'}},required:[...Object.keys(properties),'reason'],additionalProperties:false}}};
  const prompt='Use compute_bearing from 32.9857,-96.7502 to 32.9861,-96.7497 and tell me the result.';
  const rows:any[]=[];
  for(const model of [cfg.modelSuper,cfg.modelNano]) {
    let nativeMessage:any;
    for(const mode of ['native','roundtrip','thinking','json']) {
      if(mode==='roundtrip' && !nativeMessage) {rows.push({model,mode,status:'skipped',pass:false});continue;}
      let messages:any[]=[{role:'user',content:prompt}];
      if(mode==='json') messages.unshift({role:'system',content:'Return only {"actions":[{"tool":"compute_bearing","args":{"from_lat":32.9857,"from_lon":-96.7502,"to_lat":32.9861,"to_lon":-96.7497,"reason":"test"}}]}. Catalog: '+JSON.stringify(tool)});
      if(mode==='roundtrip') {
        const call=nativeMessage.tool_calls[0],a=JSON.parse(call.function.arguments);
        messages=[...messages,nativeMessage,{role:'tool',tool_call_id:call.id,content:JSON.stringify(geo(a.from_lat,a.from_lon,a.to_lat,a.to_lon))}];
      }
      const started=Date.now();
      try {
        const request:any={model,messages,stream:false,temperature:0.6,top_p:0.95,max_tokens:512,...(mode!=='json'?{tools:[tool],tool_choice:'auto'}:{})};
        if(mode==='thinking')Object.assign(request,model===cfg.modelSuper?{reasoning_effort:'none'}:{chat_template_kwargs:{enable_thinking:false}});
        const {data,response}=await client.chat.completions.create(request).withResponse();
        const message=data.choices?.[0]?.message;
        let pass=false;
        if(mode==='roundtrip')pass=Boolean(message && !message.tool_calls?.length && /meters|metres|\bm\b/i.test(message.content || ''));
        else if(mode==='thinking')pass=Boolean(message);
        else {
          const action=mode==='json'?parse(message?.content || '').actions[0]:message?.tool_calls?.[0]?.type==='function'?{tool:message.tool_calls[0].function.name,args:JSON.parse(message.tool_calls[0].function.arguments)}:undefined;
          pass=Boolean(action?.tool==='compute_bearing' && Object.keys(properties).every(k=>typeof action.args[k]==='number' && Number.isFinite(action.args[k])));
          if(mode==='native' && pass)nativeMessage=message;
        }
        rows.push({model,mode,http_status:response.status,latency_ms:Date.now()-started,pass,...(mode==='thinking'?{reasoning_present:Boolean((message as any)?.reasoning_content)}:{})});
      }catch(error:any){rows.push({model,mode,http_status:error.status || null,latency_ms:Date.now()-started,pass:false,error_type:error.name || 'Error'});if(error.status===429)break;}
    }
  }
  mkdirSync('logs',{recursive:true});writeFileSync('logs/smoke-llm.json',JSON.stringify({at:new Date().toISOString(),results:rows},null,2)+'\n');
  console.table(rows);if(rows.some(r=>['native','json'].includes(r.mode) && !r.pass) && [cfg.modelSuper,cfg.modelNano].some(model=>!rows.some(r=>r.model===model && ['native','json'].includes(r.mode) && r.pass)))process.exitCode=1;
}
