"""Fictitious loopback only: cancellation must beat the final configure continuation."""
import asyncio,json,tempfile,os
from pathlib import Path
from aiohttp import web
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
from verify_native import until
EXT=ROOT/'extension'
CHROME=Path(os.environ.get('SESSION_LAB_CHROME',str(ROOT.parents[1]/'work/chrome155/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')))
async def run():
 records=[]
 async def handle(r):
  records.append({'path':r.path,'account':r.cookies.get('account'),'header':r.headers.get('X-Session')})
  return web.Response(content_type='text/html',text='<title>'+r.path+'</title><h1>local test</h1>')
 app=web.Application();app.router.add_get('/{tail:.*}',handle);runner=web.AppRunner(app);await runner.setup();site=web.TCPSite(runner,'127.0.0.1',0);await site.start();base='http://127.0.0.1:'+str(site._server.sockets[0].getsockname()[1])
 async with async_playwright() as pw:
  with tempfile.TemporaryDirectory(prefix='ultra-lifecycle-') as profile:
   c=await pw.chromium.launch_persistent_context(profile,executable_path=str(CHROME),headless=True,ignore_default_args=['--disable-extensions'],args=['--disable-extensions-except='+str(EXT),'--load-extension='+str(EXT)])
   try:
    await c.add_cookies([{'name':'account','value':'Original','url':base}])
    ordinary=await c.new_page();await ordinary.goto(base+'/source');await ordinary.locator('h1').wait_for()
    w=c.service_workers[0] if c.service_workers else await c.wait_for_event('serviceworker')
    popup=await c.new_page();await popup.goto(w.url.replace('background.js','popup.html'))
    async def call(m):
     value=await asyncio.wait_for(popup.evaluate('m=>chrome.runtime.sendMessage(m)',m),20)
     assert value['ok'],value
     return value['result']
    ordinary_pages=[ordinary,popup]
    async def tabs():return await w.evaluate('()=>chrome.tabs.query({})')
    source=next(t for t in await tabs() if t.get('url')==base+'/source')
    a=await call({'type':'create','active':source,'name':'A'})
    async def pfor(id):
     t=next(t for t in await tabs() if t['id']==id)
     if not t.get('url','').startswith(base):return None
     return next((p for p in c.pages if p.url==t.get('url') and p not in ordinary_pages),None)
    pa=await until(lambda:pfor(a['tabId']))
    await pa.locator('h1').wait_for();await pa.evaluate("document.cookie='account=A;Path=/'")
    await call({'type':'headers','gid':a['id'],'config':{'rules':[{'enabled':True,'operation':'set','name':'X-Session','value':'A'}]}})
    # Delay only one command completion to exercise a real stop at a deterministic async boundary.
    await call({'type':'close','gid':a['id']})
    title=(await w.evaluate('()=>chrome.storage.local.get("nativeGroups")'))['nativeGroups'][0]['name']+' · SL:'+a['id']
    await w.evaluate("""()=>{const original=chrome.debugger.sendCommand.bind(chrome.debugger);let once=true;chrome.debugger.sendCommand=async(...args)=>{const result=await original(...args);if(once&&args[1]==='Target.setAutoAttach'){once=false;globalThis.__reviewBoundaryTab=args[0].tabId;await new Promise(r=>{globalThis.__reviewResumeBoundary=r});}return result;};}""")
    records.clear()
    created=await w.evaluate("""async v=>{const t=await chrome.tabs.create({url:'about:blank'});const g=await chrome.tabs.group({tabIds:[t.id]});await chrome.tabGroups.update(g,{title:v.title});await chrome.tabs.update(t.id,{url:v.url});return t.id;}""",{'title':title,'url':base+'/detach-final-configure'})
    async def boundary():return await w.evaluate('()=>globalThis.__reviewBoundaryTab')
    stopped_id=await until(boundary)
    print('USER_STOP_RESULT',json.dumps(await call({'type':'stop','active':{'id':stopped_id}})),flush=True)
    await w.evaluate('()=>globalThis.__reviewResumeBoundary()')
    await asyncio.sleep(1.2)
    assert not any(r['path']=='/detach-final-configure' for r in records),records
    stopped_tab=next(t for t in await tabs() if t['id']==created);assert stopped_tab['url'].endswith('/stopped.html'),stopped_tab
    state=await call({'type':'status'});assert all(created not in g['tabs'] for g in state['groups']),state
    print('PASS: real popup stop cancels delayed configure without sending any Profile request or leaving the stopped page',flush=True)
   finally:await c.close()
 await runner.cleanup()
asyncio.run(run())
