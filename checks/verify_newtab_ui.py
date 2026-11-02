"""Fictitious local accounts: native new tab, paste-during-attach and tab history."""
import asyncio,json,os,tempfile
from pathlib import Path
from aiohttp import web
from playwright.async_api import async_playwright
from verify_native import until
ROOT=Path(__file__).resolve().parents[1]
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
     # Hold only the attachment call for the newly created Chrome new-tab page.
     await w.evaluate("""()=>{const attach=chrome.debugger.attach.bind(chrome.debugger);let once=true;chrome.debugger.attach=async(...args)=>{if(once){once=false;globalThis.__newtabAttach=args[0].tabId;await new Promise(r=>{globalThis.__newtabRelease=r});}return attach(...args);};}""")
     t=await w.evaluate("""async group=>{const t=await chrome.tabs.create({url:'chrome://newtab/',active:true});await chrome.tabs.group({tabIds:[t.id],groupId:group});return t.id;}""",g['groupId'])
     async def attaching():return await w.evaluate('()=>globalThis.__newtabAttach')
     assert await until(attaching)==t
     records.clear();await w.evaluate('v=>chrome.tabs.update(v.id,{url:v.url})',{'id':t,'url':base+'/typed-first'})
     await asyncio.sleep(.15);await w.evaluate('v=>chrome.tabs.update(v.id,{url:v.url})',{'id':t,'url':base+'/typed-final'})
     await asyncio.sleep(.15);assert not any(r['path'].startswith('/typed') for r in records),records
     await w.evaluate('()=>globalThis.__newtabRelease()')
     async def loaded():
      tab=await w.evaluate('(id)=>chrome.tabs.get(id)',t)
      return tab if tab.get('url')==base+'/typed-final' and tab.get('status')=='complete' else None
     try:await until(loaded,timeout=12)
     except Exception:
      print('DIAGNOSTIC',await w.evaluate('(id)=>chrome.tabs.get(id)',t),await call({'type':'status'}),records,flush=True);raise
     audit=[r for r in records if r['path']=='/typed-final'];assert audit and all(r['account']=='A' and r['header']=='A' for r in audit),audit
     passed('Pasting/replacing URL while a native grouped chrome://newtab is attaching preserves latest target with only group Cookie/Header')
     state=await call({'type':'status'});ga=next(x for x in state['groups'] if x['id']==g['id']);tabs=ga['tabs'];assert t in tabs
     passed('Native right-side new tab becomes a managed group member without terminal extension blocking')
     # Repeated navigation/refresh/history changes remain one logical tab entry.
     await w.evaluate('v=>chrome.tabs.update(v.id,{url:v.url})',{'id':t,'url':base+'/history-one'})
     async def current_page():return next((p for p in c.pages if p.url==base+'/history-one'),None)
     p=await until(current_page);await p.locator('h1').wait_for()
     for path in ['/history-two','/history-three','/history-final']:
      await p.goto(base+path);await p.locator('h1').wait_for()
     await p.reload();await p.locator('h1').wait_for();await asyncio.sleep(.2)
     history=next(x for x in (await call({'type':'status'}))['groups'] if x['id']==g['id'])['history']
     matches=[h for h in history if '/history-' in h['url']];assert len(matches)==1 and matches[0]['url'].endswith('/history-final'),history
     assert matches[0]['domain']=='127.0.0.1'
     passed('Navigation and refresh update one tab-history item with latest URL and domain')
     await w.evaluate('(id)=>chrome.tabs.remove(id)',t);await asyncio.sleep(.2)
     history=next(x for x in (await call({'type':'status'}))['groups'] if x['id']==g['id'])['history'];entry=next(h for h in history if h['url'].endswith('/history-final'))
     assert entry['kind']=='closed'
     r=await call({'type':'history-open','gid':g['id'],'entry':entry['id'],'active':source});await asyncio.sleep(.4)
     history=next(x for x in (await call({'type':'status'}))['groups'] if x['id']==g['id'])['history'];assert len([h for h in history if h['url'].endswith('/history-final')])==1,history
     await call({'type':'history-open','gid':g['id'],'entry':entry['id'],'active':source})
     again=next(x for x in (await call({'type':'status'}))['groups'] if x['id']==g['id'])
     assert len(again['tabs'])==2,again['tabs']
     passed('Closing/reopening reuses one record; clicking an already-open entry focuses it instead of duplicating tabs')
     native=await w.evaluate('(id)=>chrome.tabGroups.get(id)',g['groupId']);assert 'SL:' not in native['title'] and g['id'] not in native['title'];assert native['title'].startswith('Clean name')
     passed('Native group title displays only its clean label while stable identity remains recoverable')
     await popup.reload();details=popup.locator('.group[data-gid="'+g['id']+'"] .session-history');await details.locator('summary').click()
     assert await details.locator('.history-domain').count()>0
     images=details.locator('.history-favicon');assert await images.count()>0
     await until(lambda:images.first.evaluate('(img)=>img.complete&&img.naturalWidth>0'))
     assert '/_favicon/' in await images.first.get_attribute('src')
     passed('History renders page title, domain and Chrome-local cached favicon')
     await ordinary.reload();await ordinary.locator('h1').wait_for();assert await c.cookies(base) and next(x for x in await c.cookies(base) if x['name']=='account')['value']=='Original'
     passed('Ordinary Profile Cookie remains unchanged')
     if ext.resolve()==(ROOT/'extension').resolve():(ROOT/'checks/newtab-ui-result.json').write_text(json.dumps({'passed':True,'browser':c.browser.version,'checks':report,'privacy':'Fictitious loopback accounts only'},indent=2)+'\n')
    finally:await c.close()
 finally:await runner.cleanup()
if __name__=='__main__':asyncio.run(run())
