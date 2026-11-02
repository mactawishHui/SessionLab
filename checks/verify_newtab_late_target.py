"""Fictitious loopback only: the final allow commit must not overwrite a newer user URL."""
import asyncio,json,os,tempfile
from pathlib import Path
from aiohttp import web
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
from verify_native import until
async def run():
 records=[];report=[]
 async def page(r):
  records.append({'path':r.path,'account':r.cookies.get('account'),'header':r.headers.get('X-Session')})
  if r.path=='/favicon.ico':return web.Response(status=404)
  return web.Response(text='<title>Page '+r.path+'</title><h1>'+r.path+'</h1>',content_type='text/html')
 app=web.Application();app.router.add_get('/{tail:.*}',page);runner=web.AppRunner(app);await runner.setup();server=web.TCPSite(runner,'127.0.0.1',0);await server.start();base='http://127.0.0.1:'+str(server._server.sockets[0].getsockname()[1])
 ext=Path(os.environ.get('SESSION_LAB_EXT',str(ROOT/'extension')))
 exe=os.environ.get('SESSION_LAB_CHROME',str(ROOT.parents[1]/'work/chrome155/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
 def passed(s):report.append(s);print('PASS:',s,flush=True)
 try:
  async with async_playwright() as pw:
   with tempfile.TemporaryDirectory(prefix='native-newtab-ui-') as folder:
    c=await pw.chromium.launch_persistent_context(folder,executable_path=exe,headless=True,ignore_default_args=['--disable-extensions'],args=['--disable-extensions-except='+str(ext),'--load-extension='+str(ext)])
    try:
     await c.add_cookies([{'name':'account','value':'Original','url':base}]);ordinary=await c.new_page();await ordinary.goto(base+'/source');await ordinary.locator('h1').wait_for()
     w=c.service_workers[0] if c.service_workers else await c.wait_for_event('serviceworker');popup=await c.new_page();await popup.goto(w.url.replace('background.js','popup.html'))
     async def call(m):
      r=await asyncio.wait_for(popup.evaluate('(m)=>chrome.runtime.sendMessage(m)',m),20);assert r['ok'],r;return r['result']
     source=next(t for t in await w.evaluate('()=>chrome.tabs.query({})') if t.get('url')==base+'/source')
     before=set(c.pages);g=await call({'type':'create','active':source,'name':'Clean name'})
     async def managed():return next((p for p in c.pages if p not in before and p.url==base+'/source'),None)
     a=await until(managed);await a.locator('h1').wait_for();await a.evaluate("document.cookie='account=A;Path=/'")
     await call({'type':'headers','gid':g['id'],'config':{'rules':[{'enabled':True,'operation':'set','name':'X-Session','value':'A'}]}})
     await w.evaluate("""()=>{const update=chrome.declarativeNetRequest.updateSessionRules.bind(chrome.declarativeNetRequest);let once=true;chrome.declarativeNetRequest.updateSessionRules=async(change)=>{const result=await update(change);if(once&&globalThis.__reviewTab&&(change.addRules||[]).some(r=>r.action.type==='allow'&&r.condition.tabIds?.includes(globalThis.__reviewTab))){once=false;globalThis.__reviewAllowReady=true;await new Promise(resolve=>{globalThis.__reviewAllowResume=resolve});}return result;};}""")
     t=await w.evaluate("""async v=>{const t=await chrome.tabs.create({url:'chrome://newtab/',active:true});globalThis.__reviewTab=t.id;await chrome.tabs.group({tabIds:[t.id],groupId:v.group});await chrome.tabs.update(t.id,{url:v.url});return t.id;}""",{'group':g['groupId'],'url':base+'/attach-initial'})
     async def boundary():return await w.evaluate('()=>globalThis.__reviewAllowReady')
     await until(boundary)
     records.clear();await w.evaluate('v=>chrome.tabs.update(v.id,{url:v.url})',{'id':t,'url':base+'/late-final'})
     async def final_loaded():
      tab=await w.evaluate('(id)=>chrome.tabs.get(id)',t)
      return tab if tab.get('url')==base+'/late-final' and tab.get('status')=='complete' else None
     await until(final_loaded)
     await w.evaluate('()=>globalThis.__reviewAllowResume()');await asyncio.sleep(1)
     state=await w.evaluate('(id)=>chrome.tabs.get(id)',t)
     assert state['url']==base+'/late-final',state
     assert all(r['account']=='A' and r['header']=='A' for r in records if r['path']!='/_favicon/'),records
     print('PASS: a user URL entered after final allow commit supersedes the earlier initialization target',flush=True)
    finally:await c.close()
 finally:await runner.cleanup()
if __name__=='__main__':asyncio.run(run())
