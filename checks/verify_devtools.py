"""Native DevTools durable-body regression. Fictitious localhost identities only."""
import asyncio,json,tempfile,os,base64
from pathlib import Path
from aiohttp import web
from playwright.async_api import async_playwright
from demo import make_app
from verify_native import until
ROOT=Path(__file__).resolve().parents[1]
async def run():
 report=[];app=make_app();counts={}
 async def api(r):
  counts[r.path]=counts.get(r.path,0)+1
  if 'delay' in r.path:await asyncio.sleep(.4)
  if 'redirect' in r.path:
   v=web.HTTPFound('/devtools-api?after=redirect');v.set_cookie('native_account','Renewed A',httponly=True,path='/');return v
  h={'Cache-Control':'private, max-age=600','Access-Control-Allow-Origin':r.headers.get('Origin','*'),'Access-Control-Allow-Credentials':'true'}
  if 'xml' in r.path:return web.Response(text='<result>中文</result>',content_type='application/xml',headers=h)
  if 'binary' in r.path:return web.Response(body=bytes([0,127,128,255]),content_type='application/octet-stream',headers=h)
  return web.json_response({'account':r.cookies.get('native_account'),'header':r.headers.get('X-Session-Lab-Debug'),'method':r.method,'message':'中文响应正常'},status=418 if 'status' in r.path else 200,headers=h)
 async def options(r):
  return web.Response(headers={'Access-Control-Allow-Origin':r.headers.get('Origin','*'),'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Methods':'GET,HEAD,POST,OPTIONS','Access-Control-Allow-Headers':r.headers.get('Access-Control-Request-Headers','*')})
 app.router.add_route('OPTIONS','/{tail:.*}',options)
 for path in ['api','delay','redirect','status','xml','binary']:app.router.add_get('/devtools-'+path,api)
 runner=web.AppRunner(app);await runner.setup();site=web.TCPSite(runner,'127.0.0.1',0);await site.start();base='http://127.0.0.1:'+str(site._server.sockets[0].getsockname()[1])
 cross_site=web.TCPSite(runner,'127.0.0.1',0);await cross_site.start();cross_base='http://127.0.0.1:'+str(cross_site._server.sockets[0].getsockname()[1])
 exe=Path(os.environ['SESSION_LAB_CHROME']) if os.environ.get('SESSION_LAB_CHROME') else next((Path.home()/'Library/Caches/ms-playwright').glob('chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
 async with async_playwright() as pw:
  with tempfile.TemporaryDirectory(prefix='devtools-session-') as profile:
   ext=str(ROOT/'extension');c=await pw.chromium.launch_persistent_context(profile,executable_path=str(exe),headless=True,ignore_default_args=['--disable-extensions'],args=['--disable-extensions-except='+ext,'--load-extension='+ext])
   try:
    c.on('console',lambda m:print('BROWSER',m.text,flush=True) if m.type=='error' else None)
    ordinary=await c.new_page();await ordinary.goto(base)
    async def login(p,name):
     await p.locator('#account').fill(name);await p.locator('#login').click();await p.locator('#identity').filter(has_text=name).wait_for()
    await login(ordinary,'Original');w=c.service_workers[0] if c.service_workers else await c.wait_for_event('serviceworker')
    ui=await c.new_page();await ui.goto(w.url.replace('background.js','popup.html'));source=next(t for t in await w.evaluate('()=>chrome.tabs.query({})') if t.get('url','').rstrip('/')==base)
    async def call(m):
     r=await ui.evaluate('m=>chrome.runtime.sendMessage(m)',m);assert r['ok'],r;return r['result']
    async def group(name):
     old=set(c.pages);g=await call({'type':'create','active':source,'name':name})
     async def new():return next((p for p in c.pages if p not in old and p.url.startswith(base)),None)
     p=await until(new);await p.locator('#identity').wait_for();return g,p
    a,pa=await group('DevTools A');b,pb=await group('DevTools B');await login(pa,'Account A');await login(pb,'Account B')
    for g,v in [(a,'Alpha'),(b,'Beta')]:await call({'type':'headers','gid':g['id'],'config':{'rules':[{'enabled':True,'operation':'set','name':'X-Session-Lab-Debug','value':v}]}})
    clients={};responses={};finished={}
    for label,p in [('A',pa),('B',pb),('ordinary',ordinary)]:
     d=await c.new_cdp_session(p);clients[label]=d;responses[label]={};finished[label]=set()
     d.on('Network.responseReceived',lambda e,label=label:responses[label].__setitem__(e['response']['url'],e));d.on('Network.loadingFinished',lambda e,label=label:finished[label].add(e['requestId']))
     await d.send('Network.enable',{'maxTotalBufferSize':33554432});await d.send('Network.configureDurableMessages',{'maxTotalBufferSize':33554432})
    async def body(label,url):
     async def done():
      e=responses[label].get(url);return e if e and e['requestId'] in finished[label] else None

     try:e=await until(done,timeout=8)
     except Exception:
      print('BODY TRACE',label,url,list(responses[label]),finished[label],flush=True);raise
     v=await clients[label].send('Network.getResponseBody',{'requestId':e['requestId']});return base64.b64decode(v['body']) if v['base64Encoded'] else v['body'].encode()
    async def xhr(p,url,typ='json'):
     return await p.evaluate('''({url,type})=>new Promise((resolve,reject)=>{const x=new XMLHttpRequest();x.open('GET',url);x.responseType=type;x.onload=async()=>{let v=x.response;if(type==='arraybuffer')v=[...new Uint8Array(v)];if(type==='blob')v=[...new Uint8Array(await v.arrayBuffer())];if(type==='document')v=x.responseXML?.documentElement.textContent;if(type==='text')v=x.responseText;resolve({status:x.status,value:v,headers:x.getAllResponseHeaders(),url:x.responseURL});};x.onerror=()=>reject(Error('XHR error'));x.send();})''',{'url':url,'type':typ})
    for label,p,account,h in [('A',pa,'Account A','Alpha'),('B',pb,'Account B','Beta'),('ordinary',ordinary,'Original',None)]:
     url=base+'/devtools-api?label='+label;v=(await xhr(p,url))['value'];raw=json.loads(await body(label,url));assert v==raw and (raw['account'],raw['header'])==(account,h),raw
    report.append('Native durable DevTools session reads asynchronous XHR JSON with A/B Cookie/Header isolation and ordinary Original identity')
    url=base+'/devtools-api?fetch=1';v=await pa.evaluate('u=>fetch(u).then(r=>r.json())',url);assert json.loads(await body('A',url))==v
    report.append('Native Fetch response body is readable without replaying the server request')
    before=counts['/devtools-api'];url=base+'/devtools-api?shared=1';vs=await asyncio.gather(xhr(pa,url),xhr(pb,url),xhr(ordinary,url));assert [v['value']['account'] for v in vs]==['Account A','Account B','Original'],vs;assert counts['/devtools-api']==before+3
    for label,v in zip(['A','B','ordinary'],vs):assert json.loads(await body(label,url))==v['value']
    fresh=await c.new_page();await fresh.goto(base);before=counts['/devtools-api'];v=await fresh.evaluate('u=>fetch(u).then(r=>r.json())',base+'/devtools-api?label=A');assert v['account']=='Original' and v['header'] is None and counts['/devtools-api']==before+1,(v,counts['/devtools-api'],before)
    report.append('Concurrent identical URLs and first visits from ordinary tabs cannot borrow group API content through HTTP cache')
    for typ,path in [('text','api?text=1'),('arraybuffer','binary?a=1'),('blob','binary?b=1'),('document','xml?d=1')]:
     v=await xhr(pa,base+'/devtools-'+path,typ);raw=await body('A',base+'/devtools-'+path)
     if typ in ['arraybuffer','blob']:assert v['value']==list(raw)==[0,127,128,255]
     elif typ=='document':assert v['value']=='中文'
     else:assert json.loads(v['value'])['account']=='Account A'
    report.append('XHR text, JSON, Blob, ArrayBuffer and XML values match original native Network body bytes')
    vs=await pa.evaluate('''base=>Promise.all(['abort','timeout'].map(kind=>new Promise(resolve=>{const x=new XMLHttpRequest(),events=[];x.open('GET',base+'/devtools-delay?'+kind);if(kind==='timeout')x.timeout=25;for(const event of ['load','error','timeout','abort','loadend'])x.addEventListener(event,()=>events.push(event));x.onloadend=()=>resolve({kind,status:x.status,events});x.send();if(kind==='abort')setTimeout(()=>x.abort(),20);})))''',base)
    for v in vs:assert v['status']==0 and v['events']==[v['kind'],'loadend'],vs
    v=await xhr(pa,base+'/devtools-status?http=1');assert v['status']==418 and v['value']['account']=='Account A';assert json.loads(await body('A',base+'/devtools-status?http=1'))==v['value']
    report.append('XHR abort and timeout produce one terminal event; HTTP error status retains its readable response body')
    v=await xhr(pa,base+'/devtools-redirect?login=1');assert (v['value']['account'],v['value']['header'])==('Renewed A','Alpha');assert json.loads(await body('A',base+'/devtools-api?after=redirect'))==v['value']
    assert (await xhr(pb,base+'/devtools-api?after=A'))['value']['account']=='Account B';assert (await xhr(ordinary,base+'/devtools-api?after=A'))['value']['account']=='Original'
    report.append('API redirects and response Cookie renew only the originating group; DevTools reads the final response')
    browser_session=await c.browser.new_browser_cdp_session();await browser_session.send('Browser.grantPermissions',{'permissions':['loopbackNetwork'],'origin':base})
    cross=cross_base+'/devtools-api?cors=1';v=await xhr(pa,cross);assert v['status']==200 and v['value']['header']=='Alpha';assert json.loads(await body('A',cross))==v['value']
    report.append('Cross-origin XHR retains browser CORS with no internal request marker headers')
    for disabled in [False,True]:
     await clients['A'].send('Network.setCacheDisabled',{'cacheDisabled':disabled});url=base+'/devtools-api?disableCache='+str(disabled);v=await xhr(pa,url);assert json.loads(await body('A',url))==v['value'];before=counts['/devtools-api'];outside=await fresh.evaluate('u=>fetch(u).then(r=>r.json())',url);assert outside['account']=='Original' and outside['header'] is None and counts['/devtools-api']==before+1
    report.append('DevTools Disable cache on and off both preserve response bodies and prevent group API writes into ordinary HTTP cache')
    url=base+'/devtools-api?sync=1';v=await pa.evaluate("url=>{const x=new XMLHttpRequest();x.open('GET',url,false);x.send();return JSON.parse(x.responseText)}",url);assert v['account']=='Renewed A';assert json.loads(await body('A',url))==v
    report.append('Synchronous XHR retains native semantics and its response body is readable with Keep log enabled')
    url=base+'/login';v=await pa.evaluate("url=>new Promise(resolve=>{const x=new XMLHttpRequest();x.open('POST',url);x.responseType='json';x.setRequestHeader('Content-Type','application/json');x.onload=()=>resolve(x.response);x.send(JSON.stringify({account:'Post A'}));})",url);assert v=={'ok':True} and json.loads(await body('A',url))==v
    assert (await xhr(pb,base+'/devtools-api?post=A'))['value']['account']=='Account B';assert (await xhr(ordinary,base+'/devtools-api?post=A'))['value']['account']=='Original'
    report.append('Native POST XHR response is readable and its login Cookie updates only A')
    for mode in [False,True]:
     await clients['A'].send('Network.configureDurableMessages',{'maxTotalBufferSize':33554432} if mode else {});url=base+'/devtools-api?toggle='+str(mode);v=await xhr(pa,url);assert json.loads(await body('A',url))==v['value']
    report.append('Keep log may be toggled off/on and new API bodies remain readable')
    status=await call({'type':'status','active':source});assert not status['error'],status['error']
    (ROOT/'checks/devtools-result.json').write_text(json.dumps({'passed':True,'browser':c.browser.version,'checks':report,'privacy':'Fictitious localhost accounts and headers only','scope':'Native non-range Fetch/XHR API, synchronous XHR and POST; synthetic static/range responses retain durable-body limitations'},ensure_ascii=False,indent=2)+'\n')
    for item in report:print('PASS:',item,flush=True)
   finally:await c.close()
 await runner.cleanup()
if __name__=='__main__':asyncio.run(run())
