// Synthetic native-browser smoke page. No model/provider calls or personal data.
import http from 'node:http';
const server = http.createServer((request, response) => {
  if (!['127.0.0.1', 'localhost'].includes(request.headers.host?.split(':')[0])) {
    response.writeHead(403).end(); return;
  }
  const frame = request.url.startsWith('/frame');
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(`<!doctype html><meta charset="utf-8"><title>Browser smoke</title>
  <style>body{font:18px system-ui;padding:20px}section{height:1500px}input,button,select{font:inherit}</style>
  <h1>Browser smoke</h1><label>Smoke input <input id="input" value="original"></label>
  <button id="increment" onclick="document.querySelector('#count').textContent=++window.smokeCount">Increment</button><output id="count">0</output>
  <label>Choice <select id="choice"><option value="a">Alpha</option><option value="b">Beta</option></select></label>
  <label>Check <input id="check" type="checkbox"></label>
  <div id="drag" draggable="true">Drag</div><div id="drop">Drop here</div>
  ${frame ? '' : `<iframe title="Same origin" src="/frame"></iframe><iframe title="Other origin" src="http://localhost:${server.address().port}/frame"></iframe>`}
  <section>Scroll test</section><p id="end">End of page</p>
  <script>window.smokeCount=0;console.info('browser-smoke-console');window.addEventListener('input',()=>document.body.dataset.inputEvents=String(+(document.body.dataset.inputEvents||0)+1));</script>`);
});
server.listen(0, '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}/`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => process.exit(0)));
