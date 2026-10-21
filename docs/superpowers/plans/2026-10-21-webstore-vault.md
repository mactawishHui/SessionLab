# SessionLab Web Store Vault Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement the isolated vault task; primary agent integrates and verifies.

**Goal:** Prepare a truthful store candidate with password-protected saved sessions.

**Architecture:** Separate cryptographic persistence from existing group isolation. Keep plaintext only in worker memory and Chrome session storage; persist AES-GCM ciphertext. Gate all existing group commands until setup/unlock.

**Tech Stack:** Manifest V3 ES modules, Web Crypto, chrome.storage, Node test runner, Python/Playwright browser checks.

## Tasks

- [x] Vault module and tests: extension/vault.js, checks/vault.test.mjs. Test round-trip, tampering, wrong password, migration failure, no raw data in local storage, session-only key restore. API `new SessionVault(local, session)`, `initialize()`, `status()`, `setup(password)`, `unlock(password)`, `save(groups)`. Status `{configured, unlocked, legacy}`. initialize/setup/unlock return group arrays when unlocked, otherwise null. Serialized writes. No Chrome globals required in module; storage interfaces get/set/remove mirror Chrome.
- [x] Integrate background.js: initialize vault before group use, restore existing maps only after unlock; status may return vault metadata when locked, other operations reject. setup/unlock calls serialized before filling maps. `persist()` writes encrypted snapshots; retain internal group shape. Stop any bound tabs when vault unavailable. Do not alter Cookie/Header/cache logic.
- [x] Popup form: setup with minimum 12 characters and matching confirmation, explicit privacy consent checkbox, unlock mode without confirmation/consent repetition, button busy state and generic failure text. Clear password fields after submit, never log. New groups require encryption readiness. Keep existing Header editor.
- [x] Browser verification: obtain official same-version Chrome for Testing using Google's version catalog; isolated localhost and temporary profiles only. Add setup helper to new security integration checks; run existing suites from a disposable working copy to preserve historical records. Save fresh results separately. Capture real 1280x800 screenshots of new popup and fake account workflow.
- [x] Store materials: root ZIP candidate for 1.0.1, PNG icons/promo, accurate policy and data declarations, reviewer localhost steps, ID migration caveat. Verify package source hashes/permissions and deterministic build. Push code/docs/candidate after tests. Account registration and Google identity verification remain user actions.

## Validation commands

```sh
node --test checks/vault.test.mjs
python3 scripts/package_store.py
python3 checks/verify_store_package.py
```

All runtime JS must pass `node --check`; every local documentation link must resolve. Do not reuse old 1.0.0 runtime hash assertions for 1.0.1. Review the implementation for key persistence and startup races before committing.

实际验证使用官方 Chrome for Testing 156.0.8078.4；Chrome 155.0.8059.85 对应的精确测试构建未在官方目录中找到，因此没有把新版结果标成原 155 实机复现。账号注册和最终商店提交仍待发布者完成。
