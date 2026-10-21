// Saved group data is authenticated as one snapshot. Only the browser-session
// storage area receives the derived key; local storage receives ciphertext.
const VERSION=1,ITERATIONS=600000,MAX_BYTES=64*1024*1024;
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const aad=encoder.encode('SessionLab/nativeVault/v1');
function encode(bytes){
  let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return btoa(binary);
}
function decode(value,min,max=min){
  if(typeof value!=='string'||value.length>Math.ceil(max/3)*4||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw Error('Invalid vault');
  const bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0));
  if(bytes.length<min||bytes.length>max||encode(bytes)!==value)throw Error('Invalid vault');return bytes;
}
function validateEnvelope(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==VERSION||value.kdf!=='PBKDF2-SHA256'||value.iterations!==ITERATIONS)throw Error('Invalid vault');
  return {salt:decode(value.salt,16),iv:decode(value.iv,12),ciphertext:decode(value.ciphertext,16,MAX_BYTES+16)};
}
function snapshot(groups){
  if(!Array.isArray(groups)||groups.length>100000||groups.some(g=>!g||typeof g!=='object'||Array.isArray(g)))throw Error('Invalid group data');
  const bytes=encoder.encode(JSON.stringify(groups));if(bytes.length>MAX_BYTES)throw Error('Group data is too large');return bytes;
}
function checkPassword(password,minimum){if(typeof password!=='string'||password.length<minimum||password.length>1024)throw Error('Invalid password length');}
async function derive(password,salt){
  const material=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',iterations:ITERATIONS,salt},material,256));
}
async function importKey(raw){return crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt','decrypt']);}
async function identity(envelope){
  // Canonical field order prevents unrelated object insertion order from changing identity.
  const {version,kdf,iterations,salt,iv,ciphertext}=envelope;
  return encode(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(JSON.stringify({version,kdf,iterations,salt,iv,ciphertext})))));
}
async function decrypt(envelope,key){
  const {iv,ciphertext}=validateEnvelope(envelope);
  const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:aad,tagLength:128},key,ciphertext);
  const groups=JSON.parse(decoder.decode(bytes));snapshot(groups);return groups;
}
export class SessionVault {
  #local;#session;#envelope;#configured=false;#legacy=false;#loaded=false;#key=null;#raw=null;#groups=null;#writes=Promise.resolve();
  constructor(localStorageArea,sessionStorageArea){this.#local=localStorageArea;this.#session=sessionStorageArea;}
  status(){return {configured:this.#configured,unlocked:!!this.#key,legacy:this.#legacy};}
  #serialize(work){const result=this.#writes.then(work);this.#writes=result.catch(()=>{});return result;}
  async #cleanup(){
    if(!this.#legacy)return;
    try{await this.#local.remove('nativeGroups');this.#legacy=false;}catch{/* Retry after the next successful unlock/recycle. */}
  }
  async #cache(){
    try{await this.#session.set({nativeVaultSession:{identity:await identity(this.#envelope),key:encode(this.#raw)}});}
    catch{try{await this.#session.remove('nativeVaultSession');}catch{/* An old identity cannot restore a newer envelope. */}}
  }
  async #load(){
    if(this.#loaded)return this.#groups===null?null:structuredClone(this.#groups);
    const stored=await this.#local.get(['nativeVault','nativeGroups']);
    this.#configured=Object.hasOwn(stored,'nativeVault');this.#envelope=stored.nativeVault;this.#legacy=Object.hasOwn(stored,'nativeGroups');this.#loaded=true;
    if(!this.#configured)return null;
    try{
      validateEnvelope(this.#envelope);
      const cached=(await this.#session.get('nativeVaultSession')).nativeVaultSession;
      if(!cached||cached.identity!==await identity(this.#envelope))return null;
      const raw=decode(cached.key,32),key=await importKey(raw),groups=await decrypt(this.#envelope,key);
      this.#raw=raw;this.#key=key;this.#groups=groups;await this.#cleanup();return structuredClone(groups);
    }catch{return null;}
  }
  initialize(){return this.#serialize(()=>this.#load());}
  setup(password){return this.#serialize(async()=>{
    checkPassword(password,12);await this.#load();
    // Re-read authority so a partially completed earlier setup cannot overwrite it.
    const stored=await this.#local.get(['nativeVault','nativeGroups']);
    if(Object.hasOwn(stored,'nativeVault')){this.#configured=true;this.#envelope=stored.nativeVault;throw Error('Vault is already configured');}
    const groups=Object.hasOwn(stored,'nativeGroups')?stored.nativeGroups:[],bytes=snapshot(groups);
    this.#legacy=Object.hasOwn(stored,'nativeGroups');
    const salt=crypto.getRandomValues(new Uint8Array(16)),raw=await derive(password,salt),key=await importKey(raw);
    const envelope=await this.#encrypt(bytes,key,encode(salt));
    await this.#local.set({nativeVault:envelope});this.#configured=true;this.#envelope=envelope;
    // Verify the durable ciphertext before deleting the only legacy copy.
    const persisted=(await this.#local.get('nativeVault')).nativeVault;
    if(await identity(persisted)!==await identity(envelope))throw Error('Vault verification failed');
    await decrypt(persisted,key);
    this.#key=key;this.#raw=raw;this.#groups=JSON.parse(decoder.decode(bytes));
    await this.#cache();await this.#cleanup();return structuredClone(this.#groups);
  });}
  unlock(password){return this.#serialize(async()=>{
    await this.#load();let raw,key,groups,envelope;
    try{
      checkPassword(password,1);envelope=(await this.#local.get('nativeVault')).nativeVault;
      const {salt}=validateEnvelope(envelope);raw=await derive(password,salt);key=await importKey(raw);groups=await decrypt(envelope,key);
    }catch{throw Error('Unable to unlock vault');}
    this.#envelope=envelope;this.#configured=true;this.#raw=raw;this.#key=key;this.#groups=groups;
    await this.#cache();await this.#cleanup();return structuredClone(groups);
  });}
  async #encrypt(bytes,key,salt){
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad,tagLength:128},key,bytes));
    return {version:VERSION,kdf:'PBKDF2-SHA256',iterations:ITERATIONS,salt,iv:encode(iv),ciphertext:encode(ciphertext)};
  }
  save(groups){
    // Capture at invocation, before a queued write can observe later mutations.
    let bytes;try{bytes=snapshot(groups);}catch(error){return Promise.reject(error);}
    return this.#serialize(async()=>{
      await this.#load();if(!this.#key)throw Error('Vault is locked');
      const envelope=await this.#encrypt(bytes,this.#key,this.#envelope.salt);
      await this.#local.set({nativeVault:envelope});this.#envelope=envelope;this.#groups=JSON.parse(decoder.decode(bytes));await this.#cache();await this.#cleanup();
    });
  }
}
