"""Fictitious CSRF regression: deleted host cookie must not shadow live domain token."""
import asyncio,json,os,sys,tempfile
from pathlib import Path
from aiohttp import web
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(Path(__file__).parent))
from verify_native import until

async def run():
    app=web.Application();report=[]
    html='''<!doctype html><title>CSRF test</title><h1>Fictitious CSRF regression</h1><script>window.token=()=>document.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('csrfToken='))?.slice(10)||'';</script>'''
    async def home(r):
        response=web.Response(text=html,content_type='text/html',headers={'Cache-Control':'no-store'})
        if r.path=='/expire-document':response.headers.add('Set-Cookie','csrfToken=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; HttpOnly')
        return response
    async def check(r):
        values=[c.strip().split('=',1)[1] for c in r.headers.get('Cookie','').split(';') if c.strip().startswith('csrfToken=')]
        expected=r.cookies.get('account','Original')+'-csrf'
        return web.json_response({'authorized':values==[expected] and r.headers.get('X-CSRF-Token')==expected,'account':r.cookies.get('account','Original'),'header':r.headers.get('X-Test-Env'),'cookieCount':len(values)},headers={'Cache-Control':'no-store'})
    async def expire(r):
        response=web.json_response({'ok':True});response.headers.add('Set-Cookie','csrfToken=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; HttpOnly');return response
    app.router.add_get('/',home);app.router.add_get('/expire-document',home);app.router.add_post('/expire-native',expire);app.router.add_post('/check-role',check)
    runner=web.AppRunner(app);await runner.setup();server=web.TCPSite(runner,'127.0.0.1',0);await server.start()
    base='http://app.example.test:'+str(server._server.sockets[0].getsockname()[1])
    executable=os.environ.get('SESSION_LAB_CHROME',str(ROOT.parents[1]/'work/chrome155/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
    ext=str(ROOT/'extension')
    async def launch(pw,folder):
        return await pw.chromium.launch_persistent_context(folder,executable_path=executable,headless=True,ignore_default_args=['--disable-extensions'],args=['--disable-extensions-except='+ext,'--load-extension='+ext,'--host-resolver-rules=MAP *.example.test 127.0.0.1','--no-proxy-server','--unsafely-treat-insecure-origin-as-secure='+base])
    async def setup(c):
        w=c.service_workers[0] if c.service_workers else await c.wait_for_event('serviceworker')
        popup=await c.new_page();await popup.goto(w.url.replace('background.js','popup.html'))
        cdp=await c.new_cdp_session(popup)
        await cdp.send('Browser.grantPermissions',{'origin':base,'permissions':['loopbackNetwork']})
        async def call(m):
            r=await popup.evaluate('(m)=>chrome.runtime.sendMessage(m)',m);assert r['ok'],r;return r['result']
        return w,popup,call
    async def role(p):return await p.evaluate("async()=>(await fetch('/check-role',{method:'POST',headers:{'X-CSRF-Token':window.token()}})).json()")
    def passed(s):report.append(s);print('PASS:',s,flush=True)
    try:
      async with async_playwright() as pw:
       with tempfile.TemporaryDirectory(prefix='csrf-session-') as folder:
        c=await launch(pw,folder)
        try:
          await c.add_cookies([{'name':'csrfToken','value':'Original-csrf','domain':'.example.test','path':'/','sameSite':'Lax'}])
          ordinary=await c.new_page();await ordinary.goto(base)
          w,popup,call=await setup(c)
          async def source_tab():return next((t for t in await w.evaluate('()=>chrome.tabs.query({})') if t.get('url','').rstrip('/')==base),None)
          source=await until(source_tab)
          groups=[];pages=[]
          for name in ['A','B']:
            before=set(c.pages);g=await call({'type':'create','active':source,'name':'CSRF '+name});groups.append(g)
            async def newpage():return next((p for p in c.pages if p not in before and p.url.startswith(base)),None)
            p=await until(newpage);await p.wait_for_function('window.token!==undefined');pages.append(p)
            await p.evaluate("name=>{document.cookie='account='+name+'; Domain=example.test; Path=/';document.cookie='csrfToken='+name+'-csrf; Domain=example.test; Path=/';}",name)
            await call({'type':'headers','gid':g['id'],'config':{'rules':[{'name':'X-Test-Env','value':name,'enabled':True,'operation':'set'}]}})
          for p in pages:
            await p.goto(base+'/expire-document');assert (await role(p))['authorized']
          passed('Document-response epoch deletion leaves domain CSRF valid in A and B')
          for p in pages:
            await p.evaluate("()=>fetch('/expire-native',{method:'POST'})");assert (await role(p))['authorized']
            await p.evaluate("()=>{document.cookie='temporary=present; Path=/';document.cookie='temporary=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/';}")
            assert not await p.evaluate("document.cookie.includes('temporary=')")
          passed('Native POST response and document.cookie deletion both discard epoch-zero cookies')
          values=await asyncio.gather(*(role(p) for p in [*pages,ordinary]))
          assert [(r['account'],r['header'],r['authorized']) for r in values]==[('A','A',True),('B','B',True),('Original',None,True)],values
          passed('A/B/ordinary CSRF, account and Header remain independent')
          for g in groups:await call({'type':'close','gid':g['id']})
          await w.evaluate("async()=>{const s=await chrome.storage.local.get('nativeGroups');for(const g of s.nativeGroups)g.cookies.unshift({name:'csrfToken',value:'',domain:'app.example.test',hostOnly:true,httpOnly:true,path:'/',expirationDate:0});await chrome.storage.local.set(s);}")
        finally:await c.close()
        c=await launch(pw,folder)
        try:
          w,popup,call=await setup(c)
          await call({'type':'status'})
          assert await w.evaluate("async()=>{const s=await chrome.storage.local.get('nativeGroups');return s.nativeGroups.every(g=>!g.cookies.some(c=>c.expirationDate===0));}")
          for g in groups:
            active=(await w.evaluate('()=>chrome.tabs.query({})'))[0]
            before=set(c.pages);await call({'type':'open','gid':g['id'],'active':active})
            async def restored():return next((p for p in c.pages if p not in before and p.url.startswith(base)),None)
            p=await until(restored);await p.wait_for_function('window.token!==undefined');v=await role(p);assert v['authorized'] and v['account'] in ['A','B']
          passed('Startup repairs persisted expired HttpOnly shadow cookies and restores both valid sessions')
          (ROOT/'checks/csrf-result.json').write_text(json.dumps({'passed':True,'browser':c.browser.version,'checks':report,'privacy':'Fictitious example.test loopback accounts only'},indent=2)+'\n')
        finally:await c.close()
    finally:await runner.cleanup()

if __name__=='__main__':asyncio.run(run())
