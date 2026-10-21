"""Master-password bootstrap for isolated fictitious-account browser checks."""
import os
from pathlib import Path

PASSWORD = 'session-lab-fixture-password-only'


async def unlock_fixture(popup):
    result = await popup.evaluate("()=>chrome.runtime.sendMessage({type:'status'})")
    assert result['ok'], result.get('error')
    status = result['result']['vault']
    if status['unlocked']:
        return
    result = await popup.evaluate("m=>chrome.runtime.sendMessage(m)", {
        'type': 'vault-unlock' if status['configured'] else 'vault-setup',
        'password': PASSWORD, 'consent': True,
    })
    assert result['ok'], result.get('error')


def output_dir(root):
    path = Path(os.environ.get('SESSION_LAB_CHECK_OUTPUT', root / 'checks'))
    path.mkdir(parents=True, exist_ok=True)
    return path
