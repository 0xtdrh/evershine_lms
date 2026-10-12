/**
 * L5: GET /api/h5p/[blockId]/play?g=<groupId> — the H5P player page, shown inside a sandboxed frame of the lesson.
 * Checks who may play (student with the lesson open, or staff preview), then gives the page a short-lived token for
 * the package files (the sandboxed frame has no cookies). The score goes to the parent page with postMessage.
 */

import { auth } from '@/lib/auth'
import { errors } from '@/lib/api-response'
import { playAccess } from '@/lib/h5p/engine'
import { signH5pToken } from '@/lib/h5p/token'

export const dynamic = 'force-dynamic'
const CDN = 'https://unpkg.com/h5p-standalone@3.8.0/dist'
const esc = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`)

export async function GET(request: Request, { params }: { params: Promise<{ blockId: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const { blockId } = await params
  const groupId = new URL(request.url).searchParams.get('g')
  const a = await playAccess({ id: session.user.id, role: session.user.role }, blockId, groupId)
  if (!a.ok) return new Response(`<!doctype html><meta charset="utf-8"><p style="font:14px sans-serif;color:#b91c1c">${esc(a.message ?? 'Not allowed')}</p>`, { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  const base = `/api/h5p/${encodeURIComponent(blockId)}/f/${signH5pToken(blockId, a.viewer!)}`
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${CDN}/styles/h5p.css">
<style>html,body{margin:0;padding:0;background:#fff;font-family:sans-serif}#h5p{min-height:200px}.err{color:#b91c1c;font-size:14px;padding:12px}</style>
</head><body><div id="h5p"></div>
<script src="${CDN}/main.bundle.js"></script>
<script>
(function () {
  var el = document.getElementById('h5p');
  var send = function (m) { try { parent.postMessage(Object.assign({ source: 'tn-h5p', blockId: ${JSON.stringify(blockId)} }, m), '*') } catch (e) {} };
  var resize = function () { send({ type: 'height', height: document.documentElement.scrollHeight }) };
  new H5PStandalone.H5P(el, {
    h5pJsonPath: ${JSON.stringify(base)},
    frameJs: '${CDN}/frame.bundle.js',
    frameCss: '${CDN}/styles/h5p.css',
    embedType: 'div', frame: false, copyright: false, export: false, icon: false, fullScreen: false
  }).then(function () {
    resize(); setInterval(resize, 1500);
    H5P.externalDispatcher.on('xAPI', function (event) {
      var st = event && event.data && event.data.statement;
      if (!st || !st.result) return;
      var verb = (st.verb && st.verb.id || '').split('/').pop();
      var r = st.result;
      // only the main activity counts (not each sub-question of a course presentation)
      if (st.context && st.context.contextActivities && st.context.contextActivities.parent) return;
      send({ type: 'result', verb: verb, score: r.score ? r.score.raw : null, max: r.score ? r.score.max : null, completed: !!(r.completion || verb === 'completed' || verb === 'answered' || r.success !== undefined) });
    });
  }).catch(function (e) { el.innerHTML = '<p class="err">The activity could not start.</p>'; send({ type: 'error', message: String(e && e.message || e) }) });
})();
</script></body></html>`
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'SAMEORIGIN' } })
}
