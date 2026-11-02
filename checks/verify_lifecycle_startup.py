"""Fictitious loopback only: real Chrome session restoration, not manual group reconstruction."""
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
    await w.evaluate('v=>chrome.tabs.update(v.id,{url:v.url})',{'id':a['tabId'],'url':base+'/native-saved'})
    await pa.wait_for_url(base+'/native-saved');await pa.locator('h1').wait_for()
    await pa.evaluate("sessionStorage.setItem('ultra-startup','kept')")
    # Same-URL tabs must recover separate page-specific sessions despite new Chrome tab IDs.
    page_created=asyncio.create_task(c.wait_for_event('page'))
    await call({'type':'new-tab','gid':a['id'],'active':source,'url':base+'/native-saved'})
    duplicate=await page_created;await duplicate.wait_for_url(base+'/native-saved');await duplicate.locator('h1').wait_for()
    await duplicate.evaluate("sessionStorage.setItem('ultra-startup','second')")
    # Also retain one stopped tab in the same marked group.
    stopped=await call({'type':'new-tab','gid':a['id'],'active':source,'url':base+'/stopped-saved'})
    await asyncio.sleep(.3);await call({'type':'stop','active':{'id':stopped['tabId']}})
    await asyncio.sleep(.5)
    before=await tabs();assert any(t['url'].endswith('/stopped.html') for t in before)
    await c.close();records.clear()
    c=await pw.chromium.launch_persistent_context(profile,executable_path=str(CHROME),headless=True,ignore_default_args=['--disable-extensions'],args=['--restore-last-session','--disable-extensions-except='+str(EXT),'--load-extension='+str(EXT)])
    w=c.service_workers[0] if c.service_workers else await c.wait_for_event('serviceworker')
    await asyncio.sleep(3)
    restored_tabs=await tabs();assert any(t['url'].endswith('/stopped.html') for t in restored_tabs),restored_tabs
    native_audit=[r for r in records if r['path']=='/native-saved'];assert native_audit and all(r['account']=='A' and r['header']=='A' for r in native_audit),native_audit
    assert not any(r['path']=='/source' and r['account']=='A' for r in records),records
    print('PASS: real Chrome restart restores group identity before its first request and keeps stopped tabs stopped',flush=True)
    restored_pages=[p for p in c.pages if p.url==base+'/native-saved'];assert len(restored_pages)==2,len(restored_pages)
    saved_sessions=await asyncio.gather(*(p.evaluate("sessionStorage.getItem('ultra-startup')") for p in restored_pages));assert sorted(saved_sessions,key=str)==['kept','second'],saved_sessions
    print('PASS: native startup restoration preserves independent sessionStorage for two identical URLs',flush=True)
   finally:await c.close()
 await runner.cleanup()
asyncio.run(run())
