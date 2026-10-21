"""Local account test site; fictitious accounts only. Also used for native Chrome acceptance."""
from aiohttp import web
import json,html,gzip

HTML='''<!doctype html><meta charset="utf-8"><title>Native Session Demo</title>
<style>body{font:18px -apple-system,sans-serif;max-width:800px;margin:60px auto;line-height:1.8}input,button{font:inherit;padding:10px;margin:5px}#state{white-space:pre-wrap;background:#eee;padding:20px}</style>
<h1>原生标签页多账号验证</h1><p>这是 Chrome 正常渲染的网页，可以选中文字，地址栏就是网站地址。</p>
<p>服务器登录：<strong id="identity">加载中</strong></p><input id="account" placeholder="虚构账号名"><button id="login">登录此账号</button><button id="refresh">刷新状态</button><pre id="state"></pre>
<a href="/second">同站其他页面</a><p id="copy">这段文字可以直接选中复制。</p>
<p><button id="jump">跳转登录（新标签页）</button><button id="jump-later">先开空白页再跳转</button> <a id="new-link" href="/second" target="_blank">新标签页链接</a></p>
<button id="form-jump">表单跳转登录</button><form action="/second" target="_blank"><button id="get-form">GET 表单新标签</button></form>
<script>
async function show(){const state=await(await fetch('/whoami',{cache:'no-store'})).json();identity.textContent=state.account;document.querySelector('#state').textContent=JSON.stringify({...state,localStorage:{...localStorage},scriptCookie:document.cookie},null,2);}
document.querySelector('#login').onclick=async()=>{const name=document.querySelector('#account').value;await fetch('/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account:name})});localStorage.setItem('account',name);document.cookie='script_account='+encodeURIComponent(name)+'; Path=/; SameSite=Lax';await show();};
document.querySelector('#refresh').onclick=show;show();
document.querySelector('#jump').onclick=()=>window.open('/jump?account=PopupA','_blank');
document.querySelector('#jump-later').onclick=()=>{const popup=window.open('','_blank');setTimeout(()=>{popup.location.href='/second';popup.focus();},100);};
document.querySelector('#form-jump').onclick=()=>{const form=document.createElement('form');form.action='/jump';form.method='post';form.target='_blank';for(const [name,value] of Object.entries({account:'FormPopupA',nonce:'中文 & +'})){const input=document.createElement('input');input.name=name;input.value=value;form.append(input);}document.body.append(form);form.submit();form.remove();};
</script>'''

def make_app():
    app=web.Application()
    app['jump_requests']=[]
    app['post_requests']=[]
    app['cache_requests']={}
    app['cache_versions']={}
    async def index(request):return web.Response(text=HTML,content_type='text/html',headers={'Cache-Control':'no-store'})
    async def login(request):
        account=str((await request.json()).get('account',''))[:80]
        print('DEMO LOGIN:',account,flush=True)
        response=web.json_response({'ok':True})
        response.set_cookie('native_account',account,httponly=True,path='/',samesite='Lax')
        return response
    async def who(request):return web.json_response({'account':request.cookies.get('native_account','未登录')},headers={'Cache-Control':'no-store'})
    def received(request):return {'debug':request.headers.get('X-Session-Lab-Debug'),'remove':request.headers.get('X-Remove'),'account':request.cookies.get('native_account','未登录')}
    async def echo(request):return web.json_response(received(request),headers={'Cache-Control':'no-store'})
    async def echo_page(request):return web.Response(text='<meta charset="utf-8"><title>分组 Header 验证</title><h1>服务器收到的分组 Header</h1><pre id="received">'+html.escape(json.dumps(received(request),ensure_ascii=False))+'</pre>',content_type='text/html',headers={'Cache-Control':'no-store'})
    async def sync_cookie(request):
        response=web.Response(text='ok')
        response.set_cookie('sync_cookie','isolated',path='/')
        return response
    async def jump(request):
        app['jump_requests'].append(request.cookies.get('native_account','未登录'))
        data=await request.post() if request.method=='POST' else request.query
        if request.method=='POST':app['post_requests'].append(dict(data))
        response=web.HTTPFound('/second')
        response.set_cookie('native_account',data.get('account','PopupA'),httponly=True,path='/',samesite='Lax')
        return response
    def cache_marker(request):
        key=request.path_qs+'|'+request.cookies.get('native_account','未登录')+'|'+request.headers.get('X-Session-Lab-Debug','')
        app['cache_requests'][key]=app['cache_requests'].get(key,0)+1
        return {**received(request),'stamp':app['cache_requests'][key],'version':app['cache_versions'].get(request.cookies.get('native_account','未登录'),0)}
    async def cache_probe(request):
        marker=cache_marker(request);policy=request.query.get('policy','fresh')
        cc={'no-store':'no-store','no-cache':'no-cache, max-age=600','no-cache-fields':'no-cache="X-Session-Lab-Debug", max-age=600','double-age':'max-age=600, max-age=0','zero':'max-age=0','expire':'private, max-age=1','no-age':'private'}.get(policy,'private, max-age=600')
        headers={'Cache-Control':cc}
        if policy=='vary':headers['Vary']='*'
        if policy=='age':headers['Age']='900'
        if policy=='referer':headers['Vary']='Referer'
        body='window.cacheProbe='+json.dumps(marker,ensure_ascii=False)+';'
        if request.path.endswith('delayed.js'):await __import__('asyncio').sleep(.3)
        if request.path.endswith('sync-script.js'):body+='var xhr=new XMLHttpRequest();xhr.open("GET","/whoami",false);xhr.send();window.syncCacheAccount=JSON.parse(xhr.responseText).account;'
        if request.path.endswith('utf8.js'):
            body+='window.utf8Probe="中文缓存正常";';headers['Content-Encoding']='gzip'
            response=web.Response(body=gzip.compress(body.encode()),content_type='application/javascript',charset='utf-8',headers=headers)
        else:response=web.Response(text=body,content_type='application/javascript',headers=headers)
        if policy=='cookie':response.set_cookie('cache_side_effect',str(marker['stamp']),httponly=True,path='/')
        if policy=='clear':response.headers['Clear-Site-Data']='"cache"'
        if policy=='charset':response.charset='iso-8859-1'
        return response
    async def cache_mutate(request):
        account=request.cookies.get('native_account','未登录');app['cache_versions'][account]=app['cache_versions'].get(account,0)+1
        return web.json_response({'ok':True})
    async def cache_image(request):
        marker=cache_marker(request);width={'Account A':11,'Account B':22}.get(marker['account'],33)
        return web.Response(text=f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="10"><rect width="100%" height="100%" fill="green"/></svg>',content_type='image/svg+xml',headers={'Cache-Control':'private, max-age=600'})
    async def cache_lab(request):
        return web.Response(text='''<!doctype html><meta charset="utf-8"><title>Session Lab 分组缓存验证</title><style>body{font:18px -apple-system,sans-serif;margin:50px;line-height:1.8}pre{background:#eef3ed;padding:20px}</style><h1>分组独立缓存验证</h1><p>resource 是静态脚本内容；live 是服务器实时收到的账号和 Header。</p><a href="/cache-lab">再次打开同一页</a><pre id="result">加载中</pre><script src="/cache-probe.js"></script><script>async function show(){const live=await(await fetch('/echo-headers',{cache:'no-store'})).json();document.querySelector('#result').textContent=JSON.stringify({resource:window.cacheProbe,live},null,2);}show();</script>''',content_type='text/html',headers={'Cache-Control':'no-store'})
    app.router.add_get('/',index);app.router.add_get('/second',index)
    app.router.add_post('/login',login);app.router.add_get('/whoami',who)
    app.router.add_get('/sync-cookie',sync_cookie)
    app.router.add_get('/jump',jump)
    app.router.add_post('/jump',jump)
    app.router.add_get('/echo-headers',echo);app.router.add_get('/outside-headers',echo);app.router.add_get('/echo-page',echo_page)
    app.router.add_get('/cache-lab',cache_lab);app.router.add_get('/cache-probe.js',cache_probe);app.router.add_get('/cache-utf8.js',cache_probe);app.router.add_get('/cache-probe.svg',cache_image)
    app.router.add_get('/cache-delayed.js',cache_probe);app.router.add_get('/cache-sync-script.js',cache_probe);app.router.add_post('/cache-mutate',cache_mutate)
    return app

if __name__=='__main__':web.run_app(make_app(),host='127.0.0.1',port=54910,access_log=None)
