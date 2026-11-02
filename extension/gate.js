// A declarative rule runs before any restored document reaches the network.
// The URL stays local in the fragment; there is no external service or fetch.
const destination=location.hash.slice(1);
chrome.runtime.sendMessage({type:'route',url:destination}).then(result=>{
  if(!result?.ok)throw Error(result?.error||'恢复会话失败');
}).catch(error=>{document.getElementById('state').textContent='未能确认会话，已停止加载以保护登录态。'+error.message+'。请从 Session Lab 打开该会话或恢复上次全部页面。';});
