// Per-session request headers. Configuration stays in local extension storage.
export function normalizeHeaders(value={}){
  const rules=(value.rules||[]).map(rule=>{
    const name=String(rule.name||'').trim(),operation=rule.operation;
    if(!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name))throw Error('Header 名称格式不正确');
    if(/^(cookie|set-cookie)$/i.test(name))throw Error('Cookie 由会话隔离管理，请勿通过 Header 覆盖');
    if(/^(host|content-length|connection|transfer-encoding)$/i.test(name))throw Error('Host、Content-Length 等连接字段由浏览器管理');
    if(!['set','remove'].includes(operation))throw Error('Header 操作无效');
    const text=operation==='remove'?'':String(rule.value??'');
    if(/[\r\n\0]/.test(text))throw Error('Header 值不能包含换行或空字符');
    return {enabled:rule.enabled===undefined?value.enabled!==false:rule.enabled===true,name,operation,value:text};
  });
  return {rules};
}
export function applyHeaders(headers,config){
  if(!config)return headers;
  const result=headers.slice();
  for(const rule of config.rules||[]){
    if(rule.enabled===false||rule.enabled===undefined&&config.enabled===false)continue;
    for(let i=result.length-1;i>=0;i--)if(result[i].name.toLowerCase()===rule.name.toLowerCase())result.splice(i,1);
    if(rule.operation==='set')result.push({name:rule.name,value:rule.value});
  }
  return result;
}
