/* Code homework runner (components/assignments/CodeRunner.tsx). Served from /workers with its OWN Content-Security-Policy
   (next.config.ts): the page policy never allows eval, only this worker does, and it has no page access. */
importScripts('https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js');
let py = null;
self.onmessage = async (e) => {
  const { id, code, input } = e.data;
  let out = '';
  try {
    if (!py) py = await loadPyodide();
    py.setStdout({ batched: (s) => { out += s + '\n' } });
    py.setStderr({ batched: (s) => { out += s + '\n' } });
    const lines = String(input || '').split('\n'); let i = 0;
    py.setStdin({ stdin: () => (i < lines.length ? lines[i++] : null) });
    await py.runPythonAsync(code);
    self.postMessage({ id, ok: true, out });
  } catch (err) {
    self.postMessage({ id, ok: false, out: out + String((err && err.message) || err).split('\n').slice(-3).join('\n') });
  }
};
