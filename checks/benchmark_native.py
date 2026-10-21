import os
"""Local-only timing benchmark: fresh no-store pages with many parallel assets."""
import argparse,asyncio,json,statistics,tempfile,time
from pathlib import Path
from aiohttp import web
from playwright.async_api import async_playwright

async def run(args):
    app=web.Application();count=96;assets_seen=0;apis_seen=0
    async def page(request):
        run='shared' if args.cacheable else request.query.get('run','0')
        scripts=''.join(f'<script defer src="/asset/{i}.js?run={run}"></script>' for i in range(count))
        burst='''<script>for(let i=0;i<48;i++)localStorage.setItem('cold-'+i,location.search);for(let i=0;i<32;i++)localStorage.setItem('stable','same');</script>''' if args.storage_burst else ''
        wave='''<script>addEventListener('DOMContentLoaded',()=>{window.apiWave=Promise.all(Array.from({length:48},(_,i)=>fetch('/api/'+i+'?run='+encodeURIComponent(location.search)).then(r=>r.json())));},{once:true});</script>''' if args.api_wave else ''
        return web.Response(text='<title>Local timing benchmark</title>'+burst+scripts+wave+'<h1>Local timing benchmark</h1>',content_type='text/html',headers={'Cache-Control':'no-store'})
    async def asset(request):
        nonlocal assets_seen
        assets_seen+=1
        await asyncio.sleep(.003)
        return web.Response(text='/* local fake asset */',content_type='application/javascript',headers={'Cache-Control':'public, max-age=3600' if args.cacheable else 'no-store'})
    async def api(request):
        nonlocal apis_seen
        apis_seen+=1;await asyncio.sleep(.003);return web.json_response({'value':'local-fake-value'},headers={'Cache-Control':'no-store'})
    app.router.add_get('/api/{id}',api)
    app.router.add_get('/',page);app.router.add_get('/asset/{name}',asset)
    runner=web.AppRunner(app);await runner.setup();site=web.TCPSite(runner,'127.0.0.1',0);await site.start()
    base='http://127.0.0.1:'+str(site._server.sockets[0].getsockname()[1])
    executable=(Path(os.environ['SESSION_LAB_CHROME']) if os.environ.get('SESSION_LAB_CHROME') else next((Path.home()/'Library/Caches/ms-playwright').glob('chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')))
    results={}
    async with async_playwright() as pw:
      with tempfile.TemporaryDirectory(prefix='session-native-timing-') as profile:
        ext=str(Path(args.extension).resolve())
        context=await pw.chromium.launch_persistent_context(profile,executable_path=str(executable),headless=True,ignore_default_args=['--disable-extensions'],args=['--disable-extensions-except='+ext,'--load-extension='+ext])
        try:
          if args.cookies:
            await context.add_cookies([{'name':'fake_inventory','value':'test-only','domain':f'c{i}.benchmark.invalid','path':'/','httpOnly':True,'expires':time.time()+3600} for i in range(args.cookies)])
          original=await context.new_page();await original.goto(base)
          worker=context.service_workers[0] if context.service_workers else await context.wait_for_event('serviceworker')
          popup=await context.new_page();await popup.goto(worker.url.replace('background.js','popup.html'))
          source=next(t for t in await worker.evaluate('()=>chrome.tabs.query({})') if t.get('url','').rstrip('/')==base)
          cold_start=time.perf_counter()
          response=await popup.evaluate('message=>chrome.runtime.sendMessage(message)',{'type':'create','active':source,'name':'Timing'})
          assert response['ok'],response
          managed=None
          for _ in range(500):
            managed=next((p for p in context.pages if p not in (original,popup) and p.url.startswith(base)),None)
            if managed:break
            await asyncio.sleep(.05)
          assert managed,'Managed page did not navigate'
          await managed.wait_for_load_state('load')
          if args.api_wave:await managed.evaluate('()=>window.apiWave')
          cold_open_ms=round((time.perf_counter()-cold_start)*1000,1)
          samples={'ordinary':[],'managed':[]}
          # Alternate the two cases to reduce bias from browser warm-up/load drift.
          for i in range(args.runs+1):
            for label,p in [('ordinary',original),('managed',managed)]:
              assets_before=assets_seen;apis_before=apis_seen;start=time.perf_counter();await p.goto(base+f'/?run={label}-{i}',wait_until='load')
              if args.api_wave:await p.evaluate('()=>window.apiWave')
              elapsed=(time.perf_counter()-start)*1000
              timing=await p.evaluate('()=>{const n=performance.getEntriesByType("navigation")[0],r=performance.getEntriesByType("resource");return {dom_ms:n.domContentLoadedEventEnd,load_ms:n.loadEventEnd,resources:r.length,network_resources:r.filter(x=>x.transferSize>0).length};}')
              assert timing['resources']>=count
              if i:samples[label].append({'wall_ms':round(elapsed,1),'server_asset_requests':assets_seen-assets_before,'server_api_requests':apis_seen-apis_before,**timing})
          results={'label':args.label,'browser':context.browser.version,'assets':count,'unrelated_fake_cookies':args.cookies,'storage_write_burst':args.storage_burst,'api_wave':48 if args.api_wave else 0,'runs':args.runs,'initial_group_open_wall_ms':cold_open_ms,'cache':'assets public, max-age=3600; same URLs reused' if args.cacheable else 'all test responses use Cache-Control: no-store','samples':samples,'median_wall_ms':{k:round(statistics.median(x['wall_ms'] for x in v),1) for k,v in samples.items()}}
        finally:await context.close()
    await runner.cleanup();Path(args.out).write_text(json.dumps(results,indent=2));print(json.dumps({k:v for k,v in results.items() if k!='samples'}),flush=True)
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--extension',required=True);p.add_argument('--out',required=True);p.add_argument('--label',default='native');p.add_argument('--runs',type=int,default=5);p.add_argument('--cookies',type=int,default=0);p.add_argument('--cacheable',action='store_true');p.add_argument('--storage-burst',action='store_true');p.add_argument('--api-wave',action='store_true')
    asyncio.run(run(p.parse_args()))
