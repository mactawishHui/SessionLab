"""Fictitious loopback only: immediate native regrouping must never send the prior identity."""
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
    # ordinary navigation is allowed once its first gate was routed.
    records.clear()
    await w.evaluate('''async v=>{await chrome.tabs.group({tabIds:[v.tab],groupId:v.group});await chrome.tabs.update(v.tab,{url:v.url});}''',{'tab':source['id'],'group':a['groupId'],'url':base+'/drag-immediate'})
    await asyncio.sleep(1.2)
    audit=[r for r in records if r['path']=='/drag-immediate'];print('DRAG_ORDINARY',json.dumps(audit),flush=True);assert audit and all(r['account']=='A' and r['header']=='A' for r in audit),audit
    # Create B from a fresh ordinary tab.
    another=await c.new_page();ordinary_pages.append(another);await another.goto(base+'/ordinary-b');await another.locator('h1').wait_for()
    sourceb=next(t for t in await tabs() if t.get('url')==base+'/ordinary-b')
    b=await call({'type':'create','active':sourceb,'name':'B'})
    pb=await until(lambda:pfor(b['tabId']));await pb.locator('h1').wait_for();await pb.evaluate("document.cookie='account=B;Path=/'")
    await call({'type':'headers','gid':b['id'],'config':{'rules':[{'enabled':True,'operation':'set','name':'X-Session','value':'B'}]}})
    records.clear()
    await w.evaluate('''async v=>{await chrome.tabs.group({tabIds:[v.tab],groupId:v.group});await chrome.tabs.update(v.tab,{url:v.url});}''',{'tab':a['tabId'],'group':b['groupId'],'url':base+'/drag-a-to-b'})
    await asyncio.sleep(1.5)
    audit=[r for r in records if r['path']=='/drag-a-to-b'];print('DRAG_A_B',json.dumps(audit),flush=True);assert audit and all(r['account']=='B' and r['header']=='B' for r in audit),audit
    ga=next(g for g in (await call({'type':'status'}))['groups'] if g['id']==a['id']);assert not any('/drag-a-to-b' in h['url'] for h in ga['history'])
    # Move a managed A tab into a preexisting unmarked ordinary group, then wait.
    native=await w.evaluate('''async v=>{const t=await chrome.tabs.create({url:'about:blank'});const g=await chrome.tabs.group({tabIds:[t.id]});await chrome.tabGroups.update(g,{title:'Ordinary native'});await chrome.tabs.group({tabIds:[v.tab],groupId:g});return g;}''',{'tab':source['id']})
    records.clear();await asyncio.sleep(1.0)
    await w.evaluate('v=>chrome.tabs.update(v.tab,{url:v.url})',{'tab':source['id'],'url':base+'/managed-into-native'})
    await asyncio.sleep(.5)
    audit=[r for r in records if r['path']=='/managed-into-native'];print('DRAG_TO_NATIVE',json.dumps(audit),flush=True);assert audit and all(r['account']=='A' and r['header']=='A' for r in audit),audit
    ga=next(g for g in (await call({'type':'status'}))['groups'] if g['id']==a['id']);assert source['id'] in ga['tabs']
    print('PASS: first requests after ordinary→A, A→B, and A→ordinary-native moves retain the correct managed identity',flush=True)
   finally:await c.close()
 await runner.cleanup()
asyncio.run(run())
