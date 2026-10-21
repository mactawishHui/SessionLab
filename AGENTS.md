# Session Lab maintenance rules

- Runtime is extension/, with no Python backend. README.md/INSTALL.md are user entry points; docs/ holds implementation and maintenance guidance.
- Preserve the manifest key, extension ID and storage schema for upgrades; do not remove the installed extension to update it.
- Never bypass isolation to make a page load. Ordinary tabs must not receive managed Cookie/Header rules or managed cache entries.
- Network.setCacheDisabled only bypasses reads: do not treat it or rewritten no-store response headers as proof that native cache writes are disabled.
- Keep native non-range API cache exclusion and DevTools durable-body regression coverage. Preserve explicit application range conditions.
- Temporary fetch rules must commit before requests; same-URL rule use must remain serialized across groups.
- Never block a resource queue on page JS notifications or per-write disk persistence. Preserve synchronous XHR and close/save flush behavior.
- Use the same Chrome version as the reported failure; test Keep log via Network.configureDurableMessages.
- Test only with fictitious localhost accounts/headers. Keep real Cookie, account identifiers and response bodies out of logs, docs and release packages.
- Read docs/ARCHITECTURE.md and docs/MAINTENANCE.md before changing isolation or release flows.
