import assert from 'node:assert/strict';
import {resourceDeclarations} from '../extension/credentials.js';
let count=0;
function check(html,url,type,expected){const doc=resourceDeclarations(html,'https://app.example.test/page');assert.equal(doc.policies.get(type+':'+url),expected);count++;}
check('<script src="https://cdn.example.test/a.js" crossorigin="anonymous"></script>','https://cdn.example.test/a.js','Script',true);
check('<script crossorigin="" src="https://cdn.example.test/a.js"></script>','https://cdn.example.test/a.js','Script',true);
check('<script crossorigin="use-credentials" src="https://cdn.example.test/a.js"></script>','https://cdn.example.test/a.js','Script',false);
check('<script type=module src="https://cdn.example.test/a.js"></script>','https://cdn.example.test/a.js','Script',true);
check('<script src="https://cdn.example.test/a.js"></script>','https://cdn.example.test/a.js','Script',false);
check('<base href="https://cdn.example.test/path/"><script crossorigin src="a.js?q=1&amp;b=2#hash"></script>','https://cdn.example.test/path/a.js?q=1&b=2','Script',true);
check('<SCRIPT title="a > b" CROSSORIGIN="ANONYMOUS" SRC=https://cdn.example.test/a.js></SCRIPT>','https://cdn.example.test/a.js','Script',true);
check('<!-- <script crossorigin src="https://cdn.example.test/a.js"></script> -->','https://cdn.example.test/a.js','Script',undefined);
check('<script>let text=\'<script crossorigin src="https://cdn.example.test/a.js">\';</script>','https://cdn.example.test/a.js','Script',undefined);
check('<template><script crossorigin src="https://cdn.example.test/a.js"></script></template>','https://cdn.example.test/a.js','Script',undefined);
check('<textarea><script crossorigin src="https://cdn.example.test/a.js"></script></textarea>','https://cdn.example.test/a.js','Script',undefined);
check('<link rel="stylesheet" crossorigin href="https://cdn.example.test/a.css">','https://cdn.example.test/a.css','Stylesheet',true);
check('<link rel="modulepreload" href="https://cdn.example.test/a.js">','https://cdn.example.test/a.js','Script',true);
check('<script crossorigin src="https://cdn.example.test/a.js"></script><script src="https://cdn.example.test/a.js"></script>','https://cdn.example.test/a.js','Script',null);
console.log(`PASS: ${count} resource declaration checks (fictitious URLs only)`);
