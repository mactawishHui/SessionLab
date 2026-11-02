// Resource declarations must be available BEFORE delivering HTML: Chromium's
// preload scanner can request a script before its DOM node has been inserted.
const canonical=value=>{const u=new URL(value);u.hash='';return u.href;};
const frameKey=(source,frameId)=>(source.sessionId||'top')+':'+frameId;
const entities=value=>value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi,(all,key)=>{
  if(key[0]!=='#')return {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'}[key.toLowerCase()];
  const n=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));
  return n>0&&n<=0x10ffff?String.fromCodePoint(n):'\ufffd';
});
// This scanner reads start-tag attributes only. Comments, raw text and inert
// templates cannot contribute resource declarations (including tag-like JS).
export function resourceDeclarations(html,documentUrl){
  const policies=new Map();let base=documentUrl,baseSeen=false,i=0,template=0;
  const record=(type,url,anonymous)=>{try{const key=type+':'+canonical(new URL(url,base));
    policies.set(key,policies.has(key)&&policies.get(key)!==anonymous?null:anonymous);
  }catch{/* Invalid URLs do not cause browser resource requests. */}};
  while(i<html.length){
    const start=html.indexOf('<',i);if(start<0)break;i=start+1;
    if(html.startsWith('!--',i)){const end=html.indexOf('-->',i+3);i=end<0?html.length:end+3;continue;}
    const head=/^(\/?)([a-z][a-z\d:-]*)\b/i.exec(html.slice(i));if(!head)continue;
    const name=head[2].toLowerCase(),closing=!!head[1];i+=head[0].length;
    const attrs=new Map();let quote='',end=i;
    for(;end<html.length;end++){const c=html[end];if(quote){if(c===quote)quote='';}else if(c==='"'||c==="'")quote=c;else if(c==='>')break;}
    const text=html.slice(i,end);i=Math.min(html.length,end+1);
    if(name==='template'){template=Math.max(0,template+(closing?-1:1));continue;}
    if(closing)continue;
    if(!template){
      const re=/([^\s/=>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;let match;
      while((match=re.exec(text))){const key=match[1].toLowerCase();if(!attrs.has(key))attrs.set(key,entities(match[2]??match[3]??match[4]??''));}
      if(name==='base'&&!baseSeen&&attrs.has('href')){try{base=new URL(attrs.get('href'),base).href;baseSeen=true;}catch{}}
      const anonymous=attrs.has('crossorigin')&&attrs.get('crossorigin').toLowerCase()!=='use-credentials';
      if(name==='script'&&attrs.has('src'))record('Script',attrs.get('src'),anonymous||(!attrs.has('crossorigin')&&attrs.get('type')?.toLowerCase()==='module'));
      if(name==='img'&&attrs.has('src'))record('Image',attrs.get('src'),anonymous);
      if(name==='link'&&attrs.has('href')){
        const rel=(attrs.get('rel')||'').toLowerCase().split(/\s+/),as=(attrs.get('as')||'').toLowerCase();
        const type=rel.includes('stylesheet')?'Stylesheet':rel.includes('modulepreload')?'Script':rel.includes('preload')?{script:'Script',style:'Stylesheet',font:'Font',image:'Image'}[as]:null;
        if(type)record(type,attrs.get('href'),anonymous||rel.includes('modulepreload')&&!attrs.has('crossorigin'));
      }
    }
    if(['script','style','textarea','title','xmp','iframe','noembed','noframes','noscript'].includes(name)){
      const close=new RegExp('</'+name+'[\\s/>]','ig');close.lastIndex=i;const found=close.exec(html);i=found?found.index:html.length;
    }
  }
  return {origin:new URL(documentUrl).origin,policies};
}
export function documentResources(source,p,b,chunks,type,status){
  if(p.resourceType!=='Document'||status<200||status>=300)return;
  b.resourceDocuments??=new Map();const key=frameKey(source,p.frameId);
  b.resourceDocuments.delete(key);
  if(!/^text\/html\b/i.test(type))return;
  const charset=type.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1]||'utf-8';
  try{const decoder=new TextDecoder(charset);let html='';for(const chunk of chunks)html+=decoder.decode(chunk,{stream:true});html+=decoder.decode();
    b.resourceDocuments.set(key,resourceDeclarations(html,p.request.url));
  }catch{/* DOM fallback handles unsupported document encodings. */}
}
// Never execute or wait for page JS on the request queue. DOM fallback is for
// dynamically inserted nodes; initial parser/preload requests use HTML metadata.
export async function anonymousResource(command,source,p,b){
  if(!['Script','Stylesheet','Image','Font'].includes(p.resourceType))return false;
  let target,origin;const doc=b.resourceDocuments?.get(frameKey(source,p.frameId));
  try{target=new URL(p.request.url);origin=new URL(doc?.origin||b.topUrl);}catch{return false;}
  if(target.origin===origin.origin)return false;
  if(p.resourceType==='Font')return true;
  const declared=doc?.policies.get(p.resourceType+':'+canonical(target));
  if(typeof declared==='boolean')return declared;
  if(!source.sessionId&&p.frameId!==b.frameId)return false;
  const key=source.sessionId||'top';b.domRoots??=new Map();
  try{
    let root=b.domRoots.get(key);
    if(!root){const doc=await command(source,'DOM.getDocument',{depth:0});root=doc.root.nodeId;b.domRoots.set(key,root);}
    const q=JSON.stringify(target.href);
    const selector=p.resourceType==='Script'?`script[src=${q}],link[href=${q}]`:p.resourceType==='Stylesheet'?`link[href=${q}]`:`img[src=${q}],link[href=${q}]`;
    const {nodeIds}=await command(source,'DOM.querySelectorAll',{nodeId:root,selector});
    if(!nodeIds.length)return false;
    for(const nodeId of nodeIds){
      const {attributes}=await command(source,'DOM.getAttributes',{nodeId});
      const attrs=new Map();for(let i=0;i<attributes.length;i+=2)attrs.set(attributes[i].toLowerCase(),attributes[i+1]);
      const mode=attrs.get('crossorigin');
      if(mode?.toLowerCase()==='use-credentials')return false;
      if(mode===undefined&&!(p.resourceType==='Script'&&attrs.get('type')?.toLowerCase()==='module'))return false;
    }
    return true;
  }catch{b.domRoots.delete(key);return false;}
}
