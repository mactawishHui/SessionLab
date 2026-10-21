export function base64(chunks,size){
  if(typeof Uint8Array.prototype.toBase64==='function'){
    const bytes=new Uint8Array(size);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    return bytes.toBase64();
  }
  let binary='';for(const chunk of chunks)for(let i=0;i<chunk.length;i+=32768)binary+=String.fromCharCode(...chunk.subarray(i,i+32768));
  return btoa(binary);
}
