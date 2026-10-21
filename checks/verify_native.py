import os
import asyncio,json,tempfile,sys
from pathlib import Path
from aiohttp import web
from playwright.async_api import async_playwright
from demo import make_app

ROOT=Path(__file__).resolve().parents[1]
async def until(fn,timeout=25):
    end=asyncio.get_running_loop().time()+timeout;last=None
    while asyncio.get_running_loop().time()<end:
        try:
            last=await fn()
            if last:return last
        except Exception as error:last=str(error)
        await asyncio.sleep(.15)
    raise AssertionError(str(last))

async def run():
    report=[]
    runner=web.AppRunner(make_app());await runner.setup();site=web.TCPSite(runner,'127.0.0.1',0);await site.start()
    base='http://127.0.0.1:'+str(site._server.sockets[0].getsockname()[1])
    executable=(Path(os.environ['SESSION_LAB_CHROME']) if os.environ.get('SESSION_LAB_CHROME') else next((Path.home()/'Library/Caches/ms-playwright').glob('chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')))
    async with async_playwright() as pw:
      with tempfile.TemporaryDirectory(prefix='native-session-test-') as folder:
        ext=str(ROOT/'extension')
        context=await pw.chromium.launch_persistent_context(folder,executable_path=str(executable),headless=True,ignore_default_args=['--disable-extensions'],args=['--disable-extensions-except='+ext,'--load-extension='+ext])
        context.on('console',lambda m: print('PAGE:',m.type,m.text[:160],flush=True) if m.type=='error' else None)
        context.on('page',lambda p:p.on('pageerror',lambda error:print('PAGE ERROR:',str(error),flush=True)))
        try:
          original=await context.new_page();await original.goto(base)
          async def login(page,name):
            await page.bring_to_front()
            await page.locator('#account').fill(name);await page.locator('#login').click()
            await page.locator('#identity').filter(has_text=name).wait_for()
          await login(original,'Original')
          worker=context.service_workers[0] if context.service_workers else await context.wait_for_event('serviceworker')
          popup=await context.new_page();await original.bring_to_front();await popup.goto(worker.url.replace('background.js','popup.html'))
          async def call(message):
            r=await asyncio.wait_for(popup.evaluate('(message)=>chrome.runtime.sendMessage(message)',message),30)
            assert r['ok'],r
            return r['result']
          source=(await worker.evaluate("async()=>chrome.tabs.query({})"))
          source=next(t for t in source if t.get('url','').rstrip('/')==base)
          a=await call({'type':'create','active':source,'name':'Group A'})
          async def page_for(tab_id):
            targets=await worker.evaluate('()=>chrome.tabs.query({})')
            tab=next(t for t in targets if t['id']==tab_id)
            return next((p for p in context.pages if p.url==tab.get('url') and p!=original and p!=popup),None)
          async def native_a():return next((p for p in context.pages if p not in (original,popup) and p.url.startswith(base)),None)
          page_a=await until(native_a)
          await page_a.locator('#identity').filter(has_text='Original').wait_for(timeout=25000)
          assert await page_a.evaluate("localStorage.getItem('account')")=='Original'
          assert page_a.url.startswith(base) and '/view/' not in page_a.url
          report.append('New native group inherits original HttpOnly cookie and localStorage in the same Chrome profile')
          print('PASS:',report[-1],flush=True)
          b=await call({'type':'create','active':source,'name':'Group B'})
          async def native_b():return next((p for p in context.pages if p not in (original,popup,page_a) and p.url.startswith(base)),None)
          page_b=await until(native_b);await page_b.locator('#identity').filter(has_text='Original').wait_for()
          await login(page_a,'Account A');await login(page_b,'Account B')
          await original.reload();await page_a.reload();await page_b.reload()
          await original.locator('#identity').filter(has_text='Original').wait_for()
          await page_a.locator('#identity').filter(has_text='Account A').wait_for()
          await page_b.locator('#identity').filter(has_text='Account B').wait_for()
          assert await original.evaluate("localStorage.getItem('account')")=='Original'
          assert await page_a.evaluate("localStorage.getItem('account')")=='Account A'
          assert await page_b.evaluate("localStorage.getItem('account')")=='Account B'
          report.append('Two groups keep different server logins and localStorage after reload; ordinary Chrome remains Original')
          print('PASS:',report[-1],flush=True)
          a2=await call({'type':'new-tab','gid':a['id'],'active':source})
          async def native_a2():return next((p for p in context.pages if p not in (original,popup,page_a,page_b) and p.url.startswith(base)),None)
          page_a2=await until(native_a2);await page_a2.locator('#identity').filter(has_text='Account A').wait_for()
          assert await page_a2.evaluate("localStorage.getItem('account')")=='Account A'
          await login(page_a2,'Account A2');await page_a.locator('#refresh').click()
          await page_a.locator('#identity').filter(has_text='Account A2').wait_for()
          await until(lambda:page_a.evaluate("localStorage.getItem('account')==='Account A2'"))
          report.append('Two native tabs in one Chrome group share Cookie and localStorage updates')
          print('PASS:',report[-1],flush=True)
          await page_a.evaluate("window.echoEvents=0;addEventListener('storage',e=>{if(e.key==='eventEcho'){echoEvents++;localStorage.setItem(e.key,e.newValue);}})")
          await page_a2.evaluate("window.echoEvents=0;addEventListener('storage',e=>{if(e.key==='eventEcho')echoEvents++;});localStorage.setItem('eventEcho','one')")
          await until(lambda:page_a.evaluate("window.echoEvents===1"))
          await asyncio.sleep(.1)
          assert await page_a2.evaluate('window.echoEvents')==0
          assert await page_a.evaluate("localStorage.getItem('eventEcho')")=='one'
          report.append('Idempotent localStorage writes do not emit feedback storage events or block sibling-tab requests')
          print('PASS:',report[-1],flush=True)
          await page_a2.evaluate("localStorage.clear();localStorage.setItem('afterClear','A');document.cookie='extra_cookie=A; Path=/'")
          await until(lambda:page_a.evaluate("localStorage.getItem('afterClear')==='A'"))
          assert not await original.evaluate("document.cookie.includes('extra_cookie')")
          assert await original.evaluate("localStorage.getItem('account')")=='Original'
          await page_a.reload();await page_a.locator('#identity').filter(has_text='Account A2').wait_for()
          assert await page_a.evaluate("localStorage.getItem('afterClear')")=='A'
          report.append('document.cookie and localStorage.clear affect only the managed group, including navigation')
          print('PASS:',report[-1],flush=True)
          moved=await worker.evaluate('''async groupId=>{const tab=await chrome.tabs.create({url:'about:blank',active:false});await chrome.tabs.group({tabIds:[tab.id],groupId});return tab.id;}''',a['groupId'])
          async def adopted():return next((p for p in context.pages if p not in (original,popup,page_a,page_a2,page_b) and p.url.startswith(base)),None)
          adopted_page=await until(adopted);await adopted_page.locator('#identity').filter(has_text='Account A2').wait_for()
          await worker.evaluate('({id,groupId})=>chrome.tabs.group({tabIds:[id],groupId})',{'id':moved,'groupId':b['groupId']})
          await adopted_page.locator('#identity').filter(has_text='Account B').wait_for()
          report.append('Native blank tab adopted by a managed group; moving it to another group reloads with that group identity')
          print('PASS:',report[-1],flush=True)
          await call({'type':'close','gid':a['id']});await call({'type':'open','gid':a['id'],'active':source})
          async def reopened():return next((p for p in context.pages if p not in (original,popup,page_b,adopted_page) and p.url.startswith(base)),None)
          restored=await until(reopened);await restored.locator('#identity').filter(has_text='Account A2').wait_for()
          assert await restored.evaluate("localStorage.getItem('afterClear')")=='A'
          report.append('Closing and reopening a group restores its own login and storage without re-copying the source')
          print('PASS:',report[-1],flush=True)
          await restored.screenshot(path=str(ROOT/'checks/native-demo.png'))
          # Configure A through the actual popup editor, not only its message API.
          await popup.reload();editor=popup.locator('.group[data-gid="'+a['id']+'"]')
          assert await popup.locator('select,textarea').count()==0
          await editor.locator('summary').click()
          assert await editor.locator('.headers-enabled').count()==0
          await editor.locator('.header-add').click()
          await editor.locator('.header-name').nth(0).fill('X-Session-Lab-Debug');await editor.locator('.header-value').nth(0).fill('Alpha')
          await editor.locator('.header-add').click();await editor.locator('.header-name').nth(1).fill('X-Remove');await editor.locator('.header-value').nth(1).fill('overridden')
          await editor.locator('.header-status').filter(has_text='已自动保存').wait_for()
          alpha={'rules':[{'enabled':True,'operation':'set','name':'X-Session-Lab-Debug','value':'Alpha'},{'enabled':False,'operation':'set','name':'X-Unused','value':'kept-while-off'}]}
          await call({'type':'headers','gid':b['id'],'config':{'rules':[{'enabled':True,'operation':'set','name':'X-Session-Lab-Debug','value':'Beta'}]}})
          async def echo_from(page,path='/echo-headers'):
            return await page.evaluate("async path=>(await fetch(path,{headers:{'x-session-lab-debug':'from-site','X-Remove':'remove-me'}})).json()",path)
          assert await echo_from(restored)=={'debug':'Alpha','remove':'overridden','account':'Account A2'}
          assert await echo_from(page_b)=={'debug':'Beta','remove':'remove-me','account':'Account B'}
          assert await echo_from(original)=={'debug':'from-site','remove':'remove-me','account':'Original'}
          assert (await echo_from(restored,'/outside-headers'))['debug']=='Alpha'
          before=set(context.pages);await restored.evaluate("url=>{window.open(url,'_blank');}",base+'/echo-page')
          async def header_popup():return next((p for p in context.pages if p not in before and p.url.endswith('/echo-page')),None)
          echoed=await until(header_popup);await echoed.locator('#received').wait_for()
          assert json.loads(await echoed.locator('#received').inner_text())=={'debug':'Alpha','remove':'overridden','account':'Account A2'}
          await echoed.close()
          await editor.locator('.header-enabled').nth(0).uncheck();await editor.locator('.header-status').filter(has_text='已自动保存').wait_for()
          assert await editor.locator('.header-value').nth(0).input_value()=='Alpha'
          assert await echo_from(restored)=={'debug':'from-site','remove':'overridden','account':'Account A2'}
          await editor.locator('.header-enabled').nth(0).check();await editor.locator('.header-status').filter(has_text='已自动保存').wait_for()
          await editor.locator('.header-remove').nth(1).click();await editor.locator('.header-status').filter(has_text='已自动保存').wait_for()
          assert (await echo_from(restored))['remove']=='remove-me'
          await editor.locator('.header-add').click();await editor.locator('.header-name').nth(1).fill('X-Unused');await editor.locator('.header-value').nth(1).fill('kept-while-off')
          await editor.locator('.header-enabled').nth(1).uncheck();await editor.locator('.header-status').filter(has_text='已自动保存').wait_for()
          await popup.screenshot(path=str(ROOT/'checks/header-ui.png'),full_page=True)
          report.append('Each group contains its own Header rows with individual checkboxes and add/delete controls; edits autosave and apply to all group requests including website-opened main documents; disabling one row preserves its value and other rows, B and ordinary tabs are unchanged')
          print('PASS:',report[-1],flush=True)
          await editor.locator('.header-enabled').nth(0).uncheck();await editor.locator('.header-status').filter(has_text='已自动保存').wait_for()
          assert (await echo_from(restored))['debug']=='from-site'
          for rule in [{'operation':'set','name':'Cookie','value':'wrong=identity'},{'operation':'set','name':'X-Test','value':'bad\r\nInjected: value'}]:
            invalid=await popup.evaluate('(message)=>chrome.runtime.sendMessage(message)',{'type':'headers','gid':a['id'],'config':{'enabled':True,'rules':[rule]}})
            assert not invalid['ok']
          await call({'type':'headers','gid':a['id'],'config':alpha})
          report.append('Header feature is optional and disabling restores original request headers; Cookie overrides and CRLF injection are rejected before saving')
          print('PASS:',report[-1],flush=True)
          before=set(context.pages)
          await restored.locator('#jump').click()
          async def new_popup():return next((p for p in context.pages if p not in before and p.url.startswith(base)),None)
          jumped=await until(new_popup);await jumped.locator('#identity').filter(has_text='PopupA').wait_for()
          assert runner.app['jump_requests'][-1]=='Account A2',runner.app['jump_requests']
          status=await call({'type':'status','active':source})
          group_a=next(g for g in status['groups'] if g['id']==a['id'])
          tabs=await worker.evaluate('()=>chrome.tabs.query({})')
          own=[t for t in tabs if t['id'] in group_a['tabs']]
          assert len(own)==2 and len({t['groupId'] for t in own})==1 and own[0]['groupId']>=0
          await restored.locator('#refresh').click();await restored.locator('#identity').filter(has_text='PopupA').wait_for()
          await original.reload();await page_b.reload()
          await original.locator('#identity').filter(has_text='Original').wait_for()
          await page_b.locator('#identity').filter(has_text='Account B').wait_for()
          report.append('Website login popup joins its opener group before first request; redirects and response cookies share only that group, with ordinary and B-group identities unchanged')
          print('PASS:',report[-1],flush=True)
          for selector in ['#jump-later','#new-link']:
            before=set(context.pages);await restored.locator(selector).click()
            child=await until(new_popup);await child.locator('#identity').filter(has_text='PopupA').wait_for()
          status=await call({'type':'status','active':source})
          group_a=next(g for g in status['groups'] if g['id']==a['id'])
          tabs=await worker.evaluate('()=>chrome.tabs.query({})')
          assert len(group_a['tabs'])==4 and len({t['groupId'] for t in tabs if t['id'] in group_a['tabs']})==1
          await login(restored,'Account A2')
          report.append('Async blank-popup location assignment and target=_blank links create native tabs in the same session group')
          print('PASS:',report[-1],flush=True)
          before=set(context.pages);await restored.locator('#form-jump').click()
          form_page=await until(new_popup);await form_page.locator('#identity').filter(has_text='FormPopupA').wait_for()
          assert runner.app['post_requests'][-1]=={'account':'FormPopupA','nonce':'中文 & +'},runner.app['post_requests']
          assert runner.app['jump_requests'][-1]=='Account A2'
          before=set(context.pages);await restored.locator('#get-form').click()
          get_page=await until(new_popup);await get_page.locator('#identity').filter(has_text='FormPopupA').wait_for()
          assert get_page.url==base+'/second'
          await restored.locator('#refresh').click();await restored.locator('#identity').filter(has_text='FormPopupA').wait_for()
          await original.reload();await page_b.reload()
          await original.locator('#identity').filter(has_text='Original').wait_for()
          await page_b.locator('#identity').filter(has_text='Account B').wait_for()
          status=await call({'type':'status','active':source});group_a=next(g for g in status['groups'] if g['id']==a['id'])
          tabs=await worker.evaluate('()=>chrome.tabs.query({})')
          assert len(group_a['tabs'])==6 and len({t['groupId'] for t in tabs if t['id'] in group_a['tabs']})==1
          await login(restored,'Account A2')
          report.append('GET forms and programmatic POST login forms preserve method and UTF-8 fields, follow redirects inside the opener group, and leave B and ordinary accounts unchanged')
          print('PASS:',report[-1],flush=True)
          assert await asyncio.wait_for(restored.evaluate("()=>{const xhr=new XMLHttpRequest();xhr.open('GET','/sync-cookie',false);xhr.send();return xhr.responseText;}"),10)=='ok'
          await until(lambda:restored.evaluate("document.cookie.includes('sync_cookie=isolated')"))
          assert not await original.evaluate("document.cookie.includes('sync_cookie')")
          await restored.reload();await restored.locator('#identity').filter(has_text='Account A2').wait_for()
          report.append('Synchronous XHR response cookies do not deadlock the group network queue or pollute the ordinary profile')
          print('PASS:',report[-1],flush=True)
          status=await call({'type':'status','active':source});assert not status['error'],status['error']
          await context.close()
          context=await pw.chromium.launch_persistent_context(folder,executable_path=str(executable),headless=True,ignore_default_args=['--disable-extensions'],args=['--disable-extensions-except='+ext,'--load-extension='+ext])
          worker=context.service_workers[0] if context.service_workers else await context.wait_for_event('serviceworker')
          popup=await context.new_page();await popup.goto(worker.url.replace('background.js','popup.html'))
          source=await worker.evaluate('async()=>(await chrome.tabs.query({active:true,currentWindow:true}))[0]')
          await call({'type':'open','gid':a['id'],'active':source})
          async def after_restart():return next((p for p in context.pages if p.url.startswith(base)),None)
          restored=await until(after_restart);await restored.locator('#identity').filter(has_text='Account A2').wait_for()
          assert await restored.evaluate("localStorage.getItem('afterClear')")=='A'
          assert (await echo_from(restored))['debug']=='Alpha'
          persisted=await call({'type':'status','active':source})
          unused=next(rule for group in persisted['groups'] if group['id']==a['id'] for rule in group['headers']['rules'] if rule['name']=='X-Unused')
          assert unused['value']=='kept-while-off' and unused['enabled'] is False
          report.append('Enabled per-group Header rules persist across full Chrome restart together with the group login')
          print('PASS:',report[-1],flush=True)
          report.append('Full Chrome restart restores the saved group identity from extension storage')
          print('PASS:',report[-1],flush=True)
          status=await call({'type':'status','active':source});tab_id=next(g for g in status['groups'] if g['id']==a['id'])['tabs'][0]
          await call({'type':'stop','active':{'id':tab_id}})
          await restored.wait_for_url('**/stopped.html')
          blocked=await restored.evaluate("async url=>{try{await fetch(url);return false;}catch{return true;}}",base+'/whoami')
          assert blocked
          report.append('Explicitly stopping a managed tab redirects it to an explanation and blocks its HTTP network access')
          print('PASS:',report[-1],flush=True)
          (ROOT/'checks/result.json').write_text(json.dumps({'passed':True,'checks':report,'native_urls':True,'profile_count':1,'browser':context.browser.version},ensure_ascii=False,indent=2))
        except Exception:
          print('DIAGNOSTIC URLS:',[p.url for p in context.pages],flush=True)
          if 'popup' in locals():
            print('DIAGNOSTIC STATUS:',await popup.evaluate("()=>chrome.runtime.sendMessage({type:'status'})"),flush=True)
          for p in context.pages:
            if p.url.startswith(base):print('LOCAL STATE:',await p.locator('#state').inner_text(),flush=True)
          print('FAKE COOKIE JARS:',await worker.evaluate("async()=>({groups:(await chrome.storage.local.get('nativeGroups')).nativeGroups.map(g=>({name:g.name,cookies:g.cookies}))})"),flush=True)
          raise
        finally:await context.close()
    await runner.cleanup()

if __name__=='__main__':asyncio.run(run())
