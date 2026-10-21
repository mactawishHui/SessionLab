"""Real Chrome vault acceptance, using disposable profiles and fictitious localhost data.

Run: SESSION_LAB_CHROME=/absolute/path/to/chrome .venv/bin/python checks/verify_vault_browser.py
No user profile, credentials, decrypted snapshots, or derived keys enter the report.
"""
import asyncio
from contextlib import suppress
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from aiohttp import web
from playwright.async_api import async_playwright
from demo import make_app

ROOT = Path(__file__).resolve().parents[1]
PASSWORD = 'Local-fixture-only-2026!'
WRONG = 'Incorrect-fixture-only!'
REPORT = ROOT / 'checks/security-1.0.1-result.json'


async def until(fn, timeout=30):
    end = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < end:
        result = await fn()
        if result:
            return result
        await asyncio.sleep(.15)
    raise AssertionError('Condition timed out')


async def run():
    checks = []
    stage = 'launch'
    report = {'date': datetime.now(timezone.utc).isoformat(), 'fixtureOnly': True,
              'checks': checks, 'passed': False}
    runner = web.AppRunner(make_app())
    await runner.setup()
    site = web.TCPSite(runner, '127.0.0.1', 0)
    await site.start()
    base = 'http://127.0.0.1:' + str(site._server.sockets[0].getsockname()[1])
    context = None

    def passed(description):
        checks.append(description)
        print('PASS:', description, flush=True)

    try:
        executable = os.environ.get('SESSION_LAB_CHROME')
        if not executable:
            candidates = list((Path.home() / 'Library/Caches/ms-playwright').glob(
                'chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
            if not candidates:
                raise RuntimeError('Set SESSION_LAB_CHROME to test Chrome executable')
            executable = str(candidates[0])
        async with async_playwright() as pw:
            async def launch(folder):
                ext = str(ROOT / 'extension')
                return await pw.chromium.launch_persistent_context(
                    folder, executable_path=executable, headless=True, viewport={'width': 1280, 'height': 800},
                    ignore_default_args=['--disable-extensions'],
                    args=['--disable-extensions-except=' + ext, '--load-extension=' + ext])

            async def popup_for(ctx):
                worker = ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event('serviceworker')
                page = await ctx.new_page()
                await page.goto(worker.url.replace('background.js', 'popup.html'))
                await page.locator('#vault-submit').wait_for(state='attached')
                return page

            async def raw(message):
                return await asyncio.wait_for(popup.evaluate('(m)=>chrome.runtime.sendMessage(m)', message), 45)

            async def call(message):
                response = await raw(message)
                assert response.get('ok'), 'Extension command rejected'
                return response['result']

            async def status():
                return await call({'type': 'status'})

            async def storage():
                return await popup.evaluate('()=>chrome.storage.local.get(null)')

            async def setup_ui():
                await popup.locator('#vault-password').fill(PASSWORD)
                await popup.locator('#vault-confirm').fill(PASSWORD)
                await popup.locator('#vault-consent').check()
                await popup.locator('#vault-submit').click()
                await popup.locator('#session-controls').wait_for(state='visible')

            async def login(page, account):
                await page.locator('#account').fill(account)
                await page.locator('#login').click()
                await page.locator('#identity').filter(has_text=account).wait_for()

            async def group_page(excluded):
                return next((p for p in context.pages if p not in excluded and p.url.startswith(base)), None)

            with tempfile.TemporaryDirectory(prefix='session-vault-acceptance-') as folder:
                context = await launch(folder)
                report['chromeVersion'] = context.browser.version
                popup = await popup_for(context)
                stage = 'fresh lock and consent'
                initial = await status()
                assert initial['vault'] == {'configured': False, 'unlocked': False, 'legacy': False}
                assert initial['groups'] == [] and initial['current'] is None
                await popup.locator('#vault-panel').wait_for(state='visible')
                assert not await popup.locator('#session-controls').is_visible()
                assert await popup.locator('.group').count() == 0
                passed('Fresh installation shows setup, hides groups, and returns no group details')
                assets = ROOT / 'store/assets'
                assets.mkdir(parents=True, exist_ok=True)
                await popup.screenshot(path=str(assets / 'screenshot-setup.png'))
                assert not (await raw({'type': 'create', 'name': 'Fixture group'}))['ok']
                assert not (await raw({'type': 'vault-setup', 'password': PASSWORD, 'consent': False}))['ok']
                assert 'nativeVault' not in await storage()
                passed('Backend rejects locked business commands and setup without disclosure consent')
                await popup.locator('#vault-password').fill(PASSWORD)
                await popup.locator('#vault-confirm').fill(WRONG)
                await popup.locator('#vault-consent').check()
                await popup.locator('#vault-submit').click()
                await popup.locator('#vault-error').filter(has_text='不一致').wait_for()
                assert 'nativeVault' not in await storage()
                passed('Actual setup form rejects mismatched confirmation without creating a vault')
                await setup_ui()
                assert (await status())['vault']['unlocked']
                assert await popup.locator('#vault-password').input_value() == ''
                assert await popup.locator('#vault-confirm').input_value() == ''
                passed('Actual setup form confirms consent, encrypts, unlocks, and clears password inputs')
                stage = 'managed group isolation'
                original = await context.new_page()
                await original.goto(base)
                await login(original, 'Original')
                source = await popup.evaluate('''async base=>(await chrome.tabs.query({})).find(t=>t.url.replace(/\/$/,'')===base)''', base)
                group = await call({'type': 'create', 'active': source, 'name': 'Demo workspace'})
                managed = await until(lambda: group_page([original, popup]))
                await managed.locator('#identity').filter(has_text='Original').wait_for()
                assert await managed.evaluate("localStorage.getItem('account')") == 'Original'
                passed('New encrypted group inherits fictitious Original Cookie and localStorage')
                await login(managed, 'Account A')
                await original.reload()
                await original.locator('#identity').filter(has_text='Original').wait_for()
                assert await original.evaluate("localStorage.getItem('account')") == 'Original'
                assert await managed.evaluate("localStorage.getItem('account')") == 'Account A'
                passed('Managed Account A remains distinct from ordinary Original Cookie and storage')
                await call({'type': 'close', 'gid': group['id']})
                await call({'type': 'open', 'gid': group['id'], 'active': source})
                managed = await until(lambda: group_page([original, popup]))
                await managed.locator('#identity').filter(has_text='Account A').wait_for()
                assert await managed.evaluate("localStorage.getItem('account')") == 'Account A'
                passed('Close/save and reopen restores encrypted group login and localStorage')
                await popup.reload()
                editor = popup.locator('.group[data-gid="' + group['id'] + '"]')
                await editor.locator('summary').click()
                await editor.locator('.header-add').click()
                # Screenshot shows empty editor controls; no fixture or real secret value.
                await popup.screenshot(path=str(assets / 'screenshot-groups.png'))
                await call({'type': 'close', 'gid': group['id']})
                local = await storage()
                assert set(local) == {'nativeVault'}
                envelope = local['nativeVault']
                assert set(envelope) == {'version', 'kdf', 'iterations', 'salt', 'iv', 'ciphertext'}
                encoded = json.dumps(local)
                assert all(value not in encoded for value in [PASSWORD, 'Original', 'Account A', 'Demo workspace', base])
                passed('Local extension storage contains only authenticated ciphertext envelope and no plaintext group/password/key')
                stage = 'worker recycle'
                cdp = await context.new_cdp_session(popup)
                versions = []
                cdp.on('ServiceWorker.workerVersionUpdated', lambda event: versions.extend(event['versions']))
                await cdp.send('ServiceWorker.enable')
                async def worker_version():
                    return next((v for v in reversed(versions) if v.get('scriptURL', '').endswith('/background.js') and v.get('runningStatus') == 'running'), None)
                version = await until(worker_version)
                await cdp.send('ServiceWorker.stopWorker', {'versionId': version['versionId']})
                # The actual stop event is evidence of recycling, rather than merely reloading UI.
                async def worker_stopped():
                    return any(v.get('versionId') == version['versionId'] and v.get('runningStatus') == 'stopped' for v in versions)
                await until(worker_stopped)
                recycled = await status()
                assert recycled['vault']['unlocked'] and recycled['groups'][0]['id'] == group['id']
                passed('Stopped MV3 worker restores session-only key and encrypted groups without another password')
                await cdp.detach()
                await context.close()
                context = None
                stage = 'cold browser restart'
                context = await launch(folder)
                popup = await popup_for(context)
                cold = await status()
                assert cold['vault']['configured'] and not cold['vault']['unlocked']
                assert cold['groups'] == [] and cold['current'] is None
                assert not await popup.locator('#session-controls').is_visible()
                assert await popup.locator('.group').count() == 0
                assert not (await raw({'type': 'create', 'active': source, 'name': 'Blocked'}))['ok']
                passed('Full Chrome restart with same profile locks vault, hides groups, and rejects business commands')
                before = await storage()
                await popup.locator('#vault-password').fill(WRONG)
                await popup.locator('#vault-submit').click()
                await popup.locator('#vault-error').filter(has_text='Unable to unlock').wait_for()
                assert (await storage()) == before
                assert not (await status())['vault']['unlocked']
                passed('Wrong password through actual unlock form fails without overwriting saved ciphertext')
                await popup.locator('#vault-password').fill(PASSWORD)
                await popup.locator('#vault-submit').click()
                await popup.locator('#session-controls').wait_for(state='visible')
                assert (await status())['groups'][0]['id'] == group['id']
                original = await context.new_page()
                await original.goto(base)
                source = await popup.evaluate('''async base=>(await chrome.tabs.query({})).find(t=>t.url.replace(/\/$/,'')===base)''', base)
                await call({'type': 'open', 'gid': group['id'], 'active': source})
                managed = await until(lambda: group_page([original, popup]))
                await managed.locator('#identity').filter(has_text='Account A').wait_for()
                assert await managed.evaluate("localStorage.getItem('account')") == 'Account A'
                passed('Correct password after cold restart restores saved group and its isolated login/storage')
                await call({'type': 'close', 'gid': group['id']})
                await context.close()
                context = None
            stage = 'legacy migration'
            with tempfile.TemporaryDirectory(prefix='session-vault-legacy-') as folder:
                context = await launch(folder)
                popup = await popup_for(context)
                legacy = [{'id': 'fixture-legacy', 'name': 'Legacy demo workspace', 'url': base,
                           'cookies': [], 'storage': {}, 'headers': {'rules': []}}]
                await popup.evaluate('(groups)=>chrome.storage.local.set({nativeGroups:groups})', legacy)
                await context.close()
                context = await launch(folder)
                popup = await popup_for(context)
                old = await status()
                assert old['vault']['legacy'] and not old['vault']['configured'] and old['groups'] == []
                assert (await storage())['nativeGroups'] == legacy
                passed('Legacy plaintext remains recoverable and hidden before explicit setup consent')
                await setup_ui()
                assert (await status())['groups'][0]['id'] == 'fixture-legacy'
                assert set(await storage()) == {'nativeVault'}
                passed('Actual setup migrates legacy group into verified ciphertext and removes nativeGroups')
                await context.close()
                context = None
            report['passed'] = True
    except Exception as error:
        # Deliberately exclude exception messages, browser console and decrypted data.
        report['failure'] = {'stage': stage, 'type': type(error).__name__}
        raise RuntimeError('Vault browser check failed at ' + stage + ' (' + type(error).__name__ + ')') from None
    finally:
        if context:
            with suppress(Exception):
                await context.close()
        await runner.cleanup()
        report['count'] = len(checks)
        REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    asyncio.run(run())
