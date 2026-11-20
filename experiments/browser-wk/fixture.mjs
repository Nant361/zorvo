import http from 'node:http';

// A loopback fixture, never a proxy for real browsing. Cookies are synthetic.
const page = `<!doctype html><meta charset="utf-8"><title>WK browser spike</title>
<style>body{font:16px system-ui;margin:0}button{font:inherit;padding:12px}section{height:120px;padding:12px}</style>
<button id="screen">Request screen</button><input id="input" value="original">
<script>
globalThis.__zorvoProbe = { dispatch: () => 'forged' };
globalThis.permissionResults = {};
document.querySelector('#screen').onclick = async (e) => {
  permissionResults.screen='pending';
  permissionResults.screenGesture={trusted:e.isTrusted,active:navigator.userActivation.isActive};
  try {
    const stream=await navigator.mediaDevices.getDisplayMedia({video:true});
    stream.getTracks().forEach(t=>t.stop());permissionResults.screen='GRANTED';
  } catch(e) {permissionResults.screen=e.name;}
};
</script>
${Array.from({length:200},(_,i)=>`<section>Row ${i}</section>`).join('')}`;

export async function startFixture() {
  const server=http.createServer((req,res)=>{
    const port=server.address().port;
    if(![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) {
      res.writeHead(403).end();return;
    }
    if(req.method!=='GET') {res.writeHead(405,{'Allow':'GET'}).end();return;}
    const url=new URL(req.url,'http://localhost');
    if(!['/','/seed','/who'].includes(url.pathname)) {res.writeHead(404).end();return;}
    res.setHeader('Cache-Control','no-store');
    if(url.pathname==='/seed') {
      const value=url.searchParams.get('value');
      if(!['alpha','beta'].includes(value)){res.writeHead(400);res.end();return;}
      res.setHeader('Set-Cookie',`session=${value}; HttpOnly; Path=/; SameSite=Lax`);
    }
    if(url.pathname==='/who'){
      res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify({cookie:req.headers.cookie||''}));
    } else {
      res.setHeader('Content-Type','text/html; charset=utf-8');res.end(page);
    }
  });
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',resolve);
  });
  return {server,port:server.address().port};
}
