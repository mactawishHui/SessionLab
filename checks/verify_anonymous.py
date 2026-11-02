"""Only fictitious sibling hosts, accounts and cookies, mapped to loopback."""
import asyncio,json,os,tempfile,sys
from pathlib import Path
from aiohttp import web
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(Path(__file__).parent))
from verify_native import until

async def run():
 app=web.Application();port=0;records=[];report=[]
 async def index(r):
  cdn=f'http://cdn.example.test:{port}';origin=f'http://app.example.test:{port}'
  body='<meta charset="utf-8"><title>Anonymous resource regression</title><h1>Fictitious accounts only</h1><script>window.assets={};</script>'
  if r.path=='/assets':
   body+=f'<script crossorigin="anonymous" src="{cdn}/anonymous.js"></script><script crossorigin="" src="{cdn}/empty.js"></script><script crossorigin="use-credentials" src="{cdn}/credentialled.js"></script><script src="{cdn}/classic.js"></script><script crossorigin="anonymous" src="{origin}/same.js"></script><link crossorigin="anonymous" rel="stylesheet" href="{cdn}/anonymous.css"><img id="icon" crossorigin="anonymous" src="{cdn}/anonymous.svg">'
  return web.Response(text=body,content_type='text/html',headers={'Cache-Control':'no-store'})
 async def resource(r):
  name=r.path.rsplit('/',1)[-1];account=r.cookies.get('account');h=r.headers.get('X-Test-Env');cookie=r.headers.get('Cookie','')
  records.append({'name':name,'account':account,'header':h,'cookie':bool(cookie)})
  headers={'Cache-Control':'private, max-age=600','Access-Control-Allow-Origin':r.headers.get('Origin',f'http://app.example.test:{port}'),'Access-Control-Allow-Credentials':'true'}
  anonymous=name in ['anonymous.js','empty.js','anonymous.css','anonymous.svg','dynamic.js']
  if anonymous and cookie:return web.Response(status=429,text='Anonymous request must not include cookies',headers=headers)
  value={'account':account,'header':h}
  if name.endswith('.css'):response=web.Response(text='h1{color:rgb(1, 2, 3)}',content_type='text/css',headers=headers)
  elif name.endswith('.svg'):response=web.Response(text='<svg xmlns="http://www.w3.org/2000/svg" width="17" height="10"/>',content_type='image/svg+xml',headers=headers)
  else:response=web.Response(text='window.assets['+json.dumps(name)+']='+json.dumps(value)+';',content_type='application/javascript',headers=headers)
  if anonymous:response.headers.add('Set-Cookie','anonymous_override=must-not-save; Domain=example.test; Path=/')
  return response
 app.router.add_get('/',index);app.router.add_get('/assets',index);app.router.add_get('/{name}',resource)
 runner=web.AppRunner(app);await runner.setup();server=web.TCPSite(runner,'127.0.0.1',0);await server.start();port=server._server.sockets[0].getsockname()[1]
 base=f'http://app.example.test:{port}';cdn=f'http://cdn.example.test:{port}'
 executable=os.environ.get('SESSION_LAB_CHROME',str(ROOT.parents[1]/'work/chrome155/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
 ext=str(ROOT/'extension')
 def passed(s):report.append(s);print('PASS:',s,flush=True)
 try:
  async with async_playwright() as pw:
   with tempfile.TemporaryDirectory(prefix='anonymous-session-') as folder:
    c=await pw.chromium.launch_persistent_context(folder,executable_path=executable,headless=True,ignore_default_args=['--disable-extensions'],args=['--disable-extensions-except='+ext,'--load-extension='+ext,'--host-resolver-rules=MAP *.example.test 127.0.0.1','--no-proxy-server','--unsafely-treat-insecure-origin-as-secure='+base+','+cdn])
    try:
     await c.add_cookies([{'name':'account','value':'Original','domain':'.example.test','path':'/','sameSite':'Lax'}])
     ordinary=await c.new_page();await ordinary.goto(base)
     w=c.service_workers[0] if c.service_workers else await c.wait_for_event('serviceworker')
     popup=await c.new_page();await popup.goto(w.url.replace('background.js','popup.html'))
     client=await c.new_cdp_session(popup)
     for origin in [base,cdn]:await client.send('Browser.grantPermissions',{'origin':origin,'permissions':['loopbackNetwork']})
     async def source_tab():return next((t for t in await w.evaluate('()=>chrome.tabs.query({})') if t.get('url','').rstrip('/')==base),None)
     source=await until(source_tab)
     async def call(m):
      v=await popup.evaluate('(m)=>chrome.runtime.sendMessage(m)',m);assert v['ok'],v;return v['result']
     pages=[]
     for account in ['A','B']:
      before=set(c.pages);g=await call({'type':'create','active':source,'name':'Anonymous '+account})
      async def created():return next((p for p in c.pages if p not in before and p.url.startswith(base)),None)
      p=await until(created);p.on('console',lambda m:print('FIXTURE CONSOLE',m.type,m.text[:300],flush=True) if m.type=='error' else None);await p.wait_for_function('window.assets!==undefined')
      await p.evaluate("v=>{document.cookie='account='+v+'; Domain=example.test; Path=/';}",account)
      await call({'type':'headers','gid':g['id'],'config':{'rules':[{'enabled':True,'operation':'set','name':'X-Test-Env','value':account}]}})
      await p.goto(base+'/assets')
      try:await p.wait_for_function('window.assets&&Object.keys(window.assets).length===5',timeout=10000)
      except Exception:
       print('FIXTURE RECORDS',records,flush=True);print('FIXTURE ASSETS',await p.evaluate('window.assets'),flush=True);raise
      v=await p.evaluate('window.assets')
      for name in ['anonymous.js','empty.js']:assert v[name]=={'account':None,'header':account},v
      passed('Cross-origin anonymous and empty crossorigin scripts omit Cookie while retaining group Header '+account)
      for name in ['credentialled.js','classic.js','same.js']:assert v[name]=={'account':account,'header':account},v
      passed('use-credentials, default classic cross-origin and same-origin anonymous scripts retain group identity '+account)
      assert await p.locator('h1').evaluate("e=>getComputedStyle(e).color")=='rgb(1, 2, 3)'
      assert await p.locator('#icon').evaluate('e=>e.complete&&e.naturalWidth===17')
      passed('Anonymous cross-origin CSS and image load without Cookie '+account)
      assert not await p.evaluate("document.cookie.includes('anonymous_override')")
      passed('Anonymous response Set-Cookie cannot mutate group Cookie jar '+account)
      try:
       await asyncio.wait_for(p.evaluate("url=>{const s=document.createElement('script');s.crossOrigin='anonymous';s.src=url;document.head.append(s);const xhr=new XMLHttpRequest();xhr.open('GET','/sync-probe.js',false);xhr.send();}",cdn+'/dynamic.js'),8)
      except asyncio.TimeoutError:
       debug=await call({'type':'status'})
       print('SYNCHRONOUS XHR BLOCKED; CDP METHODS:',debug['pending'],flush=True)
       raise
      passed('Cross-origin DOM credential lookup cannot block concurrent synchronous XHR '+account)
      await p.wait_for_function("window.assets['dynamic.js']!==undefined")
      assert await p.evaluate("window.assets['dynamic.js']")=={'account':None,'header':account}
      passed('Dynamically inserted anonymous script retains credential semantics '+account)
      pages.append(p)
     await ordinary.goto(base+'/assets');await ordinary.wait_for_url(base+'/assets');await ordinary.wait_for_function('window.assets&&Object.keys(window.assets).length===5')
     original=await ordinary.evaluate('window.assets')
     assert original['anonymous.js']=={'account':None,'header':None}
     assert original['credentialled.js']=={'account':'Original','header':None}
     for account,p in zip(['A','B'],pages):
      await p.reload();await p.wait_for_function('window.assets&&Object.keys(window.assets).length===5')
      assert await p.evaluate("window.assets['credentialled.js'].account")==account
      assert await p.evaluate("window.assets['anonymous.js'].header")==account
     passed('A/B warm reload and ordinary profile retain independent account/Header without shared cache fallback')
     assert not any(r['cookie'] for r in records if r['name'] in ['anonymous.js','empty.js','anonymous.css','anonymous.svg','dynamic.js']),records
     (ROOT/'checks/anonymous-result.json').write_text(json.dumps({'passed':True,'browser':c.browser.version,'checks':report,'privacy':'Only fictitious loopback sibling hosts and accounts'},indent=2)+'\n')
    finally:await c.close()
 finally:await runner.cleanup()

if __name__=='__main__':asyncio.run(run())
