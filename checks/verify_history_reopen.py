"""Fictitious loopback only: repeated and concurrent history opens preserve logical tab identity."""
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
     page_created=asyncio.create_task(c.wait_for_event('page'))
     opened=await call({'type':'new-tab','gid':g['id'],'active':source,'url':base+'/history-original'})
     original=await page_created;await original.wait_for_url(base+'/history-original');await original.locator('h1').wait_for();await original.evaluate("sessionStorage.setItem('slot','closed-slot')")
     await w.evaluate('(id)=>chrome.tabs.remove(id)',opened['tabId']);await asyncio.sleep(.2)
     group=next(x for x in (await call({'type':'status'}))['groups'] if x['id']==g['id']);entry=next(h for h in group['history'] if h['url'].endswith('/history-original'));assert entry['kind']=='closed',entry
     page_created=asyncio.create_task(c.wait_for_event('page'))
     one=await call({'type':'history-open','gid':g['id'],'entry':entry['id'],'active':source})
     p1=await page_created;await p1.wait_for_url(base+'/history-original');await p1.locator('h1').wait_for();assert await p1.evaluate("sessionStorage.getItem('slot')")=='closed-slot'
     two=await call({'type':'history-open','gid':g['id'],'entry':entry['id'],'active':source})
     assert one['tabId']==two['tabId'],(one,two)
     assert await p1.evaluate("sessionStorage.getItem('slot')")=='closed-slot'
     print('PASS: clicking an already-open history item focuses its tab and preserves page state',flush=True)
     await w.evaluate('(id)=>chrome.tabs.remove(id)',one['tabId']);await asyncio.sleep(.2)
     page_created=asyncio.create_task(c.wait_for_event('page'))
     concurrent=await asyncio.gather(*(call({'type':'history-open','gid':g['id'],'entry':entry['id'],'active':source}) for _ in range(2)))
     assert concurrent[0]['tabId']==concurrent[1]['tabId'],concurrent
     p1=await page_created;await p1.wait_for_url(base+'/history-original');await p1.locator('h1').wait_for();assert await p1.evaluate("sessionStorage.getItem('slot')")=='closed-slot'
     group=next(x for x in (await call({'type':'status'}))['groups'] if x['id']==g['id']);assert len(group['tabs'])==2,group['tabs']
     print('PASS: concurrent restoration of one closed history item creates only one live tab',flush=True)
     page_created=asyncio.create_task(c.wait_for_event('page'))
     await call({'type':'new-tab','gid':g['id'],'active':source,'url':base+'/history-original'})
     p2=await page_created;await p2.wait_for_url(base+'/history-original');await p2.locator('h1').wait_for();await p2.evaluate("sessionStorage.setItem('slot','independent-slot')")
     await p1.goto(base+'/history-live-one');await p1.locator('h1').wait_for();await p2.goto(base+'/history-live-two');await p2.locator('h1').wait_for();await asyncio.sleep(.2)
     history=next(x for x in (await call({'type':'status'}))['groups'] if x['id']==g['id'])['history'];live=[h for h in history if '/history-live-' in h['url']]
     assert len(live)==2 and len({h['tabKey'] for h in live})==2,live
     assert await p1.evaluate("sessionStorage.getItem('slot')")=='closed-slot';assert await p2.evaluate("sessionStorage.getItem('slot')")=='independent-slot'
     print('PASS: two independently opened same-URL tabs retain separate history records and sessionStorage',flush=True)
    finally:await c.close()
 finally:await runner.cleanup()
if __name__=='__main__':asyncio.run(run())
