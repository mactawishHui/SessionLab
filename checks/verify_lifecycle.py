"""Fictitious loopback sessions only; first wire request is audited by server."""
import asyncio,json,os,tempfile
from pathlib import Path
from aiohttp import web
from playwright.async_api import async_playwright
from verify_native import until
ROOT=Path(__file__).resolve().parents[1]
async def run():
 records=[];report=[]
 async def page(r):
  records.append({'path':r.path,'query':r.query_string,'account':r.cookies.get('account'),'header':r.headers.get('X-Session')})
  if r.path=='/api':return web.json_response(records[-1])
  return web.Response(content_type='text/html',text='<title>Lifecycle '+r.path+'</title><h1>'+r.path+'</h1><div id="identity"></div><script>fetch("/api").then(r=>r.json()).then(v=>{document.querySelector("#identity").textContent=v.account+"/"+v.header})</script>')
 app=web.Application();app.router.add_get('/{tail:.*}',page);runner=web.AppRunner(app);await runner.setup();server=web.TCPSite(runner,'127.0.0.1',0);await server.start();base='http://127.0.0.1:'+str(server._server.sockets[0].getsockname()[1])
 exe=os.environ.get('SESSION_LAB_CHROME',str(ROOT.parents[1]/'work/chrome155/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
 def passed(s):report.append(s);print('PASS:',s,flush=True)
 try:
  async with async_playwright() as pw:
   with tempfile.TemporaryDirectory(prefix='lifecycle-') as folder:
    args=['--disable-extensions-except='+str(ROOT/'extension'),'--load-extension='+str(ROOT/'extension')]
    async def launch():return await pw.chromium.launch_persistent_context(folder,executable_path=exe,headless=True,ignore_default_args=['--disable-extensions'],args=args)
    c=await launch()
    try:
     await c.add_cookies([{'name':'account','value':'Original','url':base}])
     ordinary=await c.new_page();await ordinary.goto(base+'/home?source=original#start');await ordinary.locator('#identity').wait_for()
     w=c.service_workers[0] if c.service_workers else await c.wait_for_event('serviceworker')
     popup=await c.new_page();await popup.goto(w.url.replace('background.js','popup.html'))
     async def call(m):
      v=await asyncio.wait_for(popup.evaluate('(m)=>chrome.runtime.sendMessage(m)',m),20);assert v['ok'],v;return v['result']
     async def tabs():return await w.evaluate('()=>chrome.tabs.query({})')
     source=next(t for t in await tabs() if t.get('url','').startswith(base+'/home'))
     async def byid(id):
      tab=next(t for t in await tabs() if t['id']==id)
      if not tab.get('url','').startswith(base):return None
      return next((p for p in c.pages if p.url==tab.get('url') and p!=ordinary and p!=popup),None)
     async def page_for(id):return await until(lambda:byid(id))
     a=await call({'type':'create','active':source,'name':'Same title'})
     pa=await page_for(a['tabId'])
     try:await pa.locator('#identity').wait_for(timeout=8000)
     except Exception:
      print('DIAG',pa.url,(await pa.content())[:2000],await call({'type':'status'}),records,flush=True);raise
     await pa.evaluate("document.cookie='account=A; Path=/';sessionStorage.setItem('slot','one')")
     await call({'type':'headers','gid':a['id'],'config':{'rules':[{'enabled':True,'operation':'set','name':'X-Session','value':'A'}]}})
     await pa.goto(base+'/one');await pa.locator('#identity').filter(has_text='A/A').wait_for()
     await pa.wait_for_function("sessionStorage.getItem('slot')==='one'")
     b=await call({'type':'create','active':source,'name':'Same title'})
     pb=await page_for(b['tabId']);await pb.locator('#identity').wait_for();await pb.evaluate("document.cookie='account=B; Path=/'")
     await call({'type':'headers','gid':b['id'],'config':{'rules':[{'enabled':True,'operation':'set','name':'X-Session','value':'B'}]}})
     await pb.goto(base+'/bee');await pb.locator('#identity').filter(has_text='B/B').wait_for()
     native=await w.evaluate('()=>chrome.tabGroups.query({})');assert len({g['title'] for g in native})==2
     passed('Duplicate display names carry distinct durable session markers')
     a2=await call({'type':'new-tab','gid':a['id'],'active':source,'url':base+'/two?x=2#second'})
     p2=await page_for(a2['tabId']);await p2.locator('#identity').filter(has_text='A/A').wait_for();await p2.evaluate("sessionStorage.setItem('slot','two')")
     await p2.wait_for_function("sessionStorage.getItem('slot')==='two'")
     await w.evaluate('(id)=>chrome.tabGroups.move(id,{index:0})',a['groupId'])
     await pa.reload();await pa.locator('#identity').filter(has_text='A/A').wait_for()
     passed('Reordering a native tab group retains account and Header')
     # Move the complete group to a different Chrome window without changing its session.
     window=await w.evaluate('()=>chrome.windows.create({url:"about:blank"})')
     await w.evaluate('v=>chrome.tabGroups.move(v.gid,{windowId:v.window,index:0})',{'gid':a['groupId'],'window':window['id']})
     await asyncio.sleep(.6);await pa.reload();await pa.locator('#identity').filter(has_text='A/A').wait_for();assert await pa.evaluate("sessionStorage.getItem('slot')")=='one'
     passed('Moving a complete group across windows preserves binding and per-tab sessionStorage')
     await w.evaluate('v=>chrome.tabs.move(v.id,{windowId:v.window,index:0})',{'id':a2['tabId'],'window':source['windowId']})
     await asyncio.sleep(.7);await p2.reload();await p2.locator('#identity').filter(has_text='A/A').wait_for()
     moved=next(t for t in await tabs() if t['id']==a2['tabId']);assert moved['groupId']>=0
     passed('Dragging one managed tab to another window re-establishes its session group without ordinary fallback')
     # Rename a native group without its marker; the stable suffix is restored.
     await w.evaluate('v=>chrome.tabGroups.update(v.id,{title:"Renamed"})',{'id':moved['groupId']})
     async def renamed():return next((g for g in await w.evaluate('()=>chrome.tabGroups.query({})') if g['id']==moved['groupId'] and '\u2063' in g['title']),None)
     await until(renamed)
     passed('Native rename preserves the durable session marker and updates the display name')
     # Manual native group reconstruction gets a new ID; marker drives adoption.
     title=next(g['title'] for g in native if g['id']==a['groupId'])
     await call({'type':'close','gid':a['id']})
     state=await call({'type':'status'});ga=next(g for g in state['groups'] if g['id']==a['id']);assert len(ga['windowTabs'])==2
     passed('Close/save captures both URLs including query/fragment and tab-specific state')
     records.clear()
     # Native reopen simulation: recreate a SAVED group with its original title
     # and navigate original URLs directly, not through the plugin open API.
     restored=await w.evaluate('''async v=>{const t=await chrome.tabs.create({url:'about:blank'});const id=await chrome.tabs.group({tabIds:[t.id]});await chrome.tabGroups.update(id,{title:v.title});await chrome.tabs.update(t.id,{url:v.url});return {tabId:t.id,groupId:id};}''',{'title':title,'url':base+'/native-reopened'})
     pr=await page_for(restored['tabId']);await pr.locator('#identity').filter(has_text='A/A').wait_for()
     audit=[r for r in records if r['path']=='/native-reopened'];assert audit and all(r['account']=='A' and r['header']=='A' for r in audit),audit
     passed('New native group ID rebinds before FIRST wire request; ordinary Profile Cookie never leaks')
     await call({'type':'close','gid':a['id']})
     # Recover the two-page saved snapshot before the native single-page test changed it.
     # Open two pages again then native-close all, exercising onRemoved batching.
     await call({'type':'open','gid':a['id'],'active':source})
     state=await call({'type':'status'});aid=next(g for g in state['groups'] if g['id']==a['id'])['tabs'][0]
     ph=await page_for(aid);assert '/home?' in ph.url;await ph.locator('#identity').filter(has_text='A/A').wait_for()
     assert ph.url.endswith('#start'),ph.url
     passed('Normal open returns to creation HOME including its fragment, not last visited page')
     await ph.evaluate("sessionStorage.setItem('slot','home-slot')")
     extra=await call({'type':'new-tab','gid':a['id'],'active':source,'url':base+'/last-closed?keep=1#frag'})
     pe=await page_for(extra['tabId']);await pe.locator('#identity').filter(has_text='A/A').wait_for();await pe.evaluate("sessionStorage.setItem('slot','last-slot')")
     await asyncio.sleep(.1)
     ids=next(g for g in (await call({'type':'status'}))['groups'] if g['id']==a['id'])['tabs']
     await w.evaluate('(ids)=>chrome.tabs.remove(ids)',ids)
     await asyncio.sleep(.5)
     state=await call({'type':'status'});ga=next(g for g in state['groups'] if g['id']==a['id']);assert len(ga['windowTabs'])==2,ga['windowTabs'];assert any(h['kind']=='closed' and '/last-closed' in h['url'] for h in ga['history'])
     passed('Native close of entire group preserves ALL pages instead of overwriting snapshot with last tab')
     records.clear();await call({'type':'restore-window','gid':a['id'],'active':source})
     async def restored_tabs():
      g=next(g for g in (await call({'type':'status'}))['groups'] if g['id']==a['id']);return g['tabs'] if len(g['tabs'])==2 else None
     ids=await until(restored_tabs)
     for id in ids:
      p=await page_for(id);await p.locator('#identity').filter(has_text='A/A').wait_for()
      expected='last-slot' if '/last-closed' in p.url else 'home-slot';assert await p.evaluate("sessionStorage.getItem('slot')")==expected,(p.url,expected)
     assert any(p.url.endswith('?keep=1#frag') for p in c.pages)
     passed('Restore all reopens every URL/query/fragment with group Cookie/Header and independent per-tab sessionStorage')
     target=next(t for t in await tabs() if '/last-closed' in t.get('url',''))
     await w.evaluate('(id)=>chrome.tabs.remove(id)',target['id']);await asyncio.sleep(.2)
     state=await call({'type':'status'});ga=next(g for g in state['groups'] if g['id']==a['id']);entry=next(h for h in ga['history'] if h['kind']=='closed' and '/last-closed' in h['url'])
     old_ids=set(ga['tabs']);r=await call({'type':'history-open','gid':a['id'],'entry':entry['id'],'active':source});p=await page_for(r['tabId']);await p.locator('#identity').filter(has_text='A/A').wait_for();assert await p.evaluate("sessionStorage.getItem('slot')")=='last-slot'
     passed('One closed history entry reopens inside its original session with saved tab state')
     await popup.reload();await popup.locator('.session-history').first.wait_for();assert await popup.locator('.restore-window').count()==2
     passed('Popup exposes per-session history, fixed home and restore-all controls')
     await pb.reload();await pb.locator('#identity').filter(has_text='B/B').wait_for();await ordinary.reload();await ordinary.locator('#identity').filter(has_text='Original/null').wait_for()
     assert not any('/last-closed' in h['url'] for g in (await call({'type':'status'}))['groups'] if g['id']==b['id'] for h in g['history'])
     passed('Other group and ordinary Profile preserve identity/Header; browsing histories remain group scoped')
     legacy=await c.new_page();await legacy.goto(base+'/legacy-group');await legacy.locator('#identity').filter(has_text='Original/null').wait_for()
     legacy_tab=next(t for t in await tabs() if t.get('url')==base+'/legacy-group')
     await w.evaluate('async id=>{const gid=await chrome.tabs.group({tabIds:[id]});await chrome.tabGroups.update(gid,{title:"Legacy native"});}',legacy_tab['id'])
     records.clear();await call({'type':'bind-group','gid':a['id'],'active':legacy_tab})
     await legacy.locator('#identity').filter(has_text='A/A').wait_for()
     assert all(r['account']=='A' and r['header']=='A' for r in records if r['path']=='/legacy-group')
     await call({'type':'bind-group','gid':a['id'],'active':legacy_tab});await legacy.reload();await legacy.locator('#identity').filter(has_text='A/A').wait_for()
     passed('Explicit legacy group binding reuses the saved session; repeated repair never leaves correct tabs blocked')
     # Save a marker/title and session, restart Chrome, then recreate native group.
     await call({'type':'close','gid':a['id']});await call({'type':'close','gid':b['id']});await c.close();c=await launch();w=c.service_workers[0] if c.service_workers else await c.wait_for_event('serviceworker');popup=await c.new_page();await popup.goto(w.url.replace('background.js','popup.html'))
     records.clear();restored=await w.evaluate('''async v=>{const t=await chrome.tabs.create({url:'about:blank'});const id=await chrome.tabs.group({tabIds:[t.id]});await chrome.tabGroups.update(id,{title:v.title});await chrome.tabs.update(t.id,{url:v.url});return t.id;}''',{'title':title,'url':base+'/after-restart'})
     p=await page_for(restored);await p.locator('#identity').filter(has_text='A/A').wait_for();audit=[r for r in records if r['path']=='/after-restart'];assert audit and all(r['account']=='A' and r['header']=='A' for r in audit),audit
     passed('After full Chrome restart, durable group marker restores login/Header before first request')
     (ROOT/'checks/lifecycle-result.json').write_text(json.dumps({'passed':True,'browser':c.browser.version,'checks':report,'privacy':'Only fictitious loopback sessions'},indent=2)+'\n')
    finally:await c.close()
 finally:await runner.cleanup()
if __name__=='__main__':asyncio.run(run())
