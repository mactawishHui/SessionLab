from vault_fixture import unlock_fixture, output_dir
import os
"""Real-browser cache isolation checks; all accounts/headers are local fakes."""
import asyncio,json,tempfile
from pathlib import Path
from aiohttp import web
from playwright.async_api import async_playwright
from demo import make_app
from verify_native import until
ROOT=Path(__file__).resolve().parents[1]
OUTPUT=output_dir(ROOT)

async def run():
    report=[];app=make_app();runner=web.AppRunner(app);await runner.setup();site=web.TCPSite(runner,'127.0.0.1',0);await site.start()
    base='http://127.0.0.1:'+str(site._server.sockets[0].getsockname()[1])
    executable=(Path(os.environ['SESSION_LAB_CHROME']) if os.environ.get('SESSION_LAB_CHROME') else next((Path.home()/'Library/Caches/ms-playwright').glob('chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')))
    async with async_playwright() as pw:
      with tempfile.TemporaryDirectory(prefix='session-cache-test-') as profile:
        ext=str(ROOT/'extension');context=await pw.chromium.launch_persistent_context(profile,executable_path=str(executable),headless=True,ignore_default_args=['--disable-extensions'],args=['--disable-extensions-except='+ext,'--load-extension='+ext])
        try:
          original=await context.new_page();await original.goto(base)
          async def login(page,name):
            await page.locator('#account').fill(name)
            async with page.expect_response('**/login') as response:
              await page.locator('#login').click()
            await response.value;await page.locator('#identity').filter(has_text=name).wait_for()
          await login(original,'Original')
          worker=context.service_workers[0] if context.service_workers else await context.wait_for_event('serviceworker')
          popup=await context.new_page();await popup.goto(worker.url.replace('background.js','popup.html'))
          await unlock_fixture(popup)
          source=next(t for t in await worker.evaluate('()=>chrome.tabs.query({})') if t.get('url','').rstrip('/')==base)
          async def call(message):
            r=await asyncio.wait_for(popup.evaluate('m=>chrome.runtime.sendMessage(m)',message),30);assert r['ok'],r;return r['result']
          async def group(name):
            before=set(context.pages);g=await call({'type':'create','active':source,'name':name})
            async def new():return next((p for p in context.pages if p not in before and p.url.startswith(base)),None)
            page=await until(new);await page.locator('#identity').wait_for();return g,page
          a,pa=await group('Cache A');b,pb=await group('Cache B')
          async def config(gid,value):
            return await call({'type':'headers','gid':gid,'config':{'rules':[] if value is None else [{'enabled':True,'operation':'set','name':'X-Session-Lab-Debug','value':value}]}})
          async def probe(page,path='/cache-probe.js'):
            await page.add_script_tag(url=base+path);return await page.evaluate('window.cacheProbe')
          async def stats(gid):
            state=await call({'type':'status','active':source});return next(g['cache'] for g in state['groups'] if g['id']==gid)
          async def warmed(gid):return (await stats(gid))['entries']>0
          async def settled(gid):return (await stats(gid))['inFlightChanges']==0
          def count(path,account,debug=''):return app['cache_requests'].get(path+'|'+account+'|'+debug,0)
          ordinary=await probe(original);assert ordinary['account']=='Original'
          # Identical snapshots still have distinct cache buckets, not just distinct keys.
          x=await probe(pa);await until(lambda:warmed(a['id']));y=await probe(pb);await until(lambda:warmed(b['id']))
          assert count('/cache-probe.js','Original')==3
          assert (await probe(pa))['stamp']==x['stamp'] and count('/cache-probe.js','Original')==3
          report.append('Different groups never share cache entries even with identical initial account/header snapshots; repeated requests in one group hit its own cache')
          await login(pa,'Account A');await login(pb,'Account B');await config(a['id'],'Alpha');await config(b['id'],'Beta')
          await until(lambda:settled(a['id']));await until(lambda:settled(b['id']))
          xa=await probe(pa);await until(lambda:warmed(a['id']));xb=await probe(pb);await until(lambda:warmed(b['id']))
          assert (xa['account'],xa['debug'])==('Account A','Alpha') and (xb['account'],xb['debug'])==('Account B','Beta')
          assert (await probe(pa))==xa and (await probe(pb))==xb
          assert count('/cache-probe.js','Account A','Alpha')==1 and count('/cache-probe.js','Account B','Beta')==1
          # Cold ordinary cache is essential: a pre-existing Profile entry can
          # conceal managed responses accidentally writing into shared cache.
          cold='/cache-probe.js?cold-ordinary=1'
          await probe(pa,cold)
          assert (await probe(original,cold))['account']=='Original','cold network response entered ordinary cache'
          cold='/cache-probe.js?cold-ordinary=2'
          await probe(pb,cold);await until(lambda:warmed(b['id']))
          await probe(pb,cold)
          assert (await probe(original,cold))['account']=='Original'
          cold='/cache-probe.js?cold-api=1'
          assert 'Account A' in await pa.evaluate("u=>fetch(u).then(r=>r.text())",base+cold)
          assert 'Original' in await original.evaluate("u=>fetch(u).then(r=>r.text())",base+cold)
          after=await probe(original);assert after==ordinary and count('/cache-probe.js','Original')==3
          report.append('Same-URL personalized static responses stay isolated for A/Alpha, B/Beta and ordinary Chrome; managed network responses and synthetic hits do not overwrite ordinary cache')
          await config(a['id'],'Preview');preview=await probe(pa);assert preview['debug']=='Preview';await until(lambda:warmed(a['id']))
          await config(a['id'],'Alpha');again=await probe(pa);assert again['debug']=='Alpha' and again['stamp']>xa['stamp']
          await config(a['id'],None);assert (await probe(pa))['debug'] is None
          assert (await probe(pb))==xb
          report.append('Editing, disabling and restoring group Header rules invalidates old variants before use, without changing B or ordinary requests')
          await login(pa,'Account A2');changed=await probe(pa);assert changed['account']=='Account A2'
          assert (await probe(original))['account']=='Original' and (await probe(pb))['account']=='Account B'
          report.append('Login POST and Cookie changes invalidate prior identity content; another group and ordinary login/cache remain unchanged')
          for policy in ['no-store','no-cache','no-cache-fields','double-age','zero','vary','age','cookie','clear','no-age','charset']:
            path='/cache-probe.js?policy='+policy;await probe(pa,path);await probe(pa,path)
            assert count(path,'Account A2')==2,(policy,app['cache_requests'])
          report.append('No-store, no-cache, max-age=0, Vary:*, expired Age, Set-Cookie and Clear-Site-Data responses are never reused')
          path='/cache-probe.js?policy=expire';await probe(pa,path);await asyncio.sleep(1.2);await probe(pa,path);assert count(path,'Account A2')==2
          report.append('Expired resources go back to network instead of serving stale data')
          old=await probe(pa)
          await pa.evaluate("()=>fetch('/cache-mutate',{method:'POST'})")
          new=await probe(pa);assert new['version']>old['version'] and new['stamp']>old['stamp']
          report.append('State-changing POST invalidates cached content even when the server keeps the same login Cookie')
          delayed=asyncio.create_task(probe(pa,'/cache-delayed.js'))
          async def started():return count('/cache-delayed.js','Account A2')>0
          await until(started);await config(a['id'],'Race');await delayed
          fresh=await probe(pa,'/cache-delayed.js');assert fresh['debug']=='Race'
          await config(a['id'],None);fresh=await probe(pa,'/cache-delayed.js');assert fresh['debug'] is None and fresh['stamp']==2
          report.append('A response started before a Header switch cannot populate or replay into the new cache generation')
          await pa.goto(base+'/?ref=one');p1=await probe(pa,'/cache-probe.js?policy=referer');await until(lambda:warmed(a['id']))
          await pa.goto(base+'/?ref=two');p2=await probe(pa,'/cache-probe.js?policy=referer');assert p2['stamp']>p1['stamp']
          report.append('Vary response headers are checked against each current request, including Referer variations')
          await probe(pa,'/cache-utf8.js');await until(lambda:warmed(a['id']));assert await pa.evaluate('window.utf8Probe')=='中文缓存正常'
          await probe(pa,'/cache-utf8.js');assert await pa.evaluate('window.utf8Probe')=='中文缓存正常';assert count('/cache-utf8.js','Account A2')==1
          async def image(page):return await page.evaluate('url=>new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i.naturalWidth);i.onerror=reject;i.src=url;})',base+'/cache-probe.svg')
          assert await image(pb)==22;await until(lambda:warmed(b['id']));assert await image(pb)==22;assert count('/cache-probe.svg','Account B','Beta')==1
          report.append('Compressed UTF-8 script bodies and binary/image responses replay correctly on cache hits')
          await probe(pa,'/cache-sync-script.js');await until(lambda:warmed(a['id']))
          await asyncio.wait_for(probe(pa,'/cache-sync-script.js'),10)
          assert await pa.evaluate('window.syncCacheAccount')=='Account A2' and count('/cache-sync-script.js','Account A2')==1
          before=count('/cache-probe.js','Account A2')
          await pa.evaluate("()=>fetch('/cache-probe.js').then(r=>r.text())")
          await pa.evaluate("()=>fetch('/cache-probe.js').then(r=>r.text())")
          assert count('/cache-probe.js','Account A2')==before+2
          report.append('Cached script execution can make synchronous XHR without deadlock; API/fetch requests are always sent to the network')
          before=set(context.pages);await call({'type':'new-tab','gid':b['id'],'active':source,'url':base+'/'})
          async def new_b():return next((p for p in context.pages if p not in before and p.url.startswith(base)),None)
          second=await until(new_b);await second.locator('#identity').filter(has_text='Account B').wait_for()
          assert (await probe(second))==xb and count('/cache-probe.js','Account B','Beta')==1
          report.append('Native tabs in one group share its warm cache without borrowing another group or the Profile cache')
          # Browser/extension redirects can have no ordinary HTTP response.
          await config(a['id'],'Redirect')
          await worker.evaluate('args=>chrome.declarativeNetRequest.updateSessionRules({addRules:[{id:900000000,priority:300,condition:{urlFilter:"|"+args.base+"/extension-redirect|",initiatorDomains:[chrome.runtime.id],resourceTypes:["xmlhttprequest"]},action:{type:"redirect",redirect:{url:args.base+"/echo-page"}}}]})',{'base':base})
          for _ in range(5):
            await pa.goto(base+'/extension-redirect',wait_until='domcontentloaded',timeout=10000)
            redirected=json.loads(await pa.locator('#received').inner_text())
            assert (redirected['account'],redirected['debug'])==('Account A2','Redirect'),redirected
          await worker.evaluate('()=>chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[900000000]})')
          assert (await probe(pb))==xb and (await probe(original))['account']=='Original'
          report.append('Browser-internal redirects retain the source group account/Header and do not affect B or ordinary tabs')
          await config(a['id'],'Alpha')
          async def concurrent_probe(page,expected_account,expected_header,i):
            value=await page.evaluate('u=>fetch(u).then(r=>r.text())',base+'/cache-probe.js?parallel='+str(i))
            marker=json.loads(value.removeprefix('window.cacheProbe=').removesuffix(';'))
            assert (marker['account'],marker['debug'])==(expected_account,expected_header),marker
          await asyncio.gather(*(concurrent_probe(page,account,head,i) for i in range(8) for page,account,head in [(pa,'Account A2','Alpha'),(pb,'Account B','Beta'),(original,'Original',None)]))
          report.append('Batched concurrent request rules preserve each group Cookie/Header for identical URLs, with ordinary requests unchanged')
          order=await popup.evaluate('''async()=>{
            const {header,put}=await import('./cookies.js');
            const parent={name:'auth',value:'parent',domain:'.example.test',hostOnly:false,path:'/',sameSite:'lax',secure:true,httpOnly:true};
            const child={...parent,value:'child',domain:'app.example.test',hostOnly:true};const jar=[parent,child];
            const read=()=>header(jar,'https://app.example.test/x','https://app.example.test/',true,'GET');
            const result=[read()];put(jar,{...parent,value:'renewed'});result.push(read());
            put(jar,{...child,expirationDate:Date.now()/1000-1});result.push(read());return result;
          }''')
          assert order==['auth=parent; auth=child','auth=child; auth=renewed','auth=renewed'],order
          report.append('Cookie domain indexing preserves duplicate-name ordering and updates replacement/expiry without changing scope')
          state=await call({'type':'status','active':source});assert not state['error'],state['error']
          (OUTPUT/'cache-result.json').write_text(json.dumps({'passed':True,'browser':context.browser.version,'checks':report,'privacy':'Synthetic localhost accounts/headers only; no real credentials or user cache keys recorded'},indent=2,ensure_ascii=False)+'\n')
          for item in report:print('PASS:',item,flush=True)
        except Exception:
          print('LOCAL CACHE COUNTS:',dict(app['cache_requests']),flush=True)
          if 'popup' in locals():
            state=await call({'type':'status','active':source});print('CACHE STATS:',[{k:g[k] for k in ['name','cache']} for g in state['groups']], 'ERROR:',state['error'],flush=True)
          raise
        finally:await context.close()
    await runner.cleanup()
if __name__=='__main__':asyncio.run(run())
