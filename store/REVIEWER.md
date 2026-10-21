# Reviewer instructions — Session Lab Native 1.0.1

Purpose: isolate user-created tab groups into distinct login sessions in one Chrome profile. It uses chrome.debugger and local, password-encrypted session snapshots, not a remote proxy service. Debugging must stay attached. No paid subscription or developer-hosted user account is required.

## Local, fictitious-account verification

Use a disposable Chrome profile. Do not import a real browser profile or provide real account credentials. Source is public at https://github.com/mactawishHui/SessionLab . The optional local fixture uses Python, but normal extension users need no Python/backend.

From the source repository:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -c "import sys;sys.path.insert(0,'checks');from aiohttp import web;from demo import make_app;web.run_app(make_app(),host='127.0.0.1',port=8765)"
```

1. Install the store test item in the disposable profile. Visit http://127.0.0.1:8765 and log in as the fictitious `Original` account.
2. Open the extension. Read the data disclosure; choose your own test-only master password of at least 12 characters, repeat it, check the acknowledgement and submit. Do not use a real account password.
3. Select the ordinary localhost page; create a group called Demo A. It inherits Original. In that group's page, log in as the fictitious Account A.
4. Select the original ordinary page, create Demo B and log in there as Account B. Refresh the two groups and ordinary page: expected Account A, Account B and Original respectively.
5. Open another tab through the extension in Demo A. Account A should be shared in this group.
6. Add a fictitious per-group Header in the extension. Toggle the individual checkbox. It applies only within this group; do not enter a real token.
7. Close/save a group, reopen it: it retains its account. Close Chrome completely, reopen the profile and extension: it must ask for the master password before showing saved group details. A wrong password must not reveal or erase saved data. Correct password restores the group.

## Data and permissions

Creation snapshots all Cookies in the current profile Cookie store, not only one site's Cookies, to allow inherited multi-site sign-in/SSO. It snapshots current-site localStorage/sessionStorage. This scope is disclosed in the extension setup and privacy policy; no developer data collection endpoint is configured.

Saved group snapshots in chrome.storage.local use AES-256-GCM with a PBKDF2-SHA256 derived key. The master password is not stored. A derived key is held only in chrome.storage.session (trusted extension contexts) to survive background worker suspension, and cleared by Chrome on browser restart/extension reload. Legacy nativeGroups migrates only after explicit setup; durable encrypted write is authenticated before legacy removal. Removal failures remain visible and are retried.

Debugging plus DNR/webRequest protects ordinary Profile Cookie/cache from managed group responses. A browser debugging banner is expected and not suppressed. Unsupported network/storage features fail or are disabled; the extension does not promise compatibility with arbitrary sites. Page-owned IndexedDB/CacheStorage is outside master-password encryption; the API-layer isolation is not a browser kernel security boundary.

See store/PERMISSIONS.md and PRIVACY.md for the complete disclosure. Actual review outcome belongs to Chrome Web Store; no claim of approval is made in this candidate.
