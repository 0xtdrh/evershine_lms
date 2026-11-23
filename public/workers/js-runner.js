/* Code homework runner (components/assignments/CodeRunner.tsx). Served from /workers with its OWN Content-Security-Policy
   (next.config.ts): the page policy never allows eval, only this worker does, and it has no page access. */
self.onmessage = (e) => {
  const { id, code, input } = e.data;
  let out = '';
  const lines = String(input || '').split('\n'); let i = 0;
  const log = (...a) => { out += a.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ') + '\n' };
  const con = { log, error: log, warn: log, info: log };
  const readLine = () => (i < lines.length ? lines[i++] : '');
  try {
    new Function('console', 'prompt', 'readLine', 'fetch', 'XMLHttpRequest', 'importScripts', code)(con, readLine, readLine, undefined, undefined, undefined);
    self.postMessage({ id, ok: true, out });
  } catch (err) {
    self.postMessage({ id, ok: false, out: out + String((err && err.message) || err) });
  }
};
