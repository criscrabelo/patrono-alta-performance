// Sprint 2, Hardening H4 (docs/PRODUCTION_GATE.md; docs/DECISIONS.md, PROD-H4-01): extraído do <script>
// inline que existia em status.html — uma Content-Security-Policy sem 'unsafe-inline' em script-src
// para elementos <script> exige que todo script venha de um arquivo externo same-origin.
async function refresh() {
  try {
    const [h, m, s] = await Promise.all([
      fetch('/api/health').then(r => r.json()),
      fetch('/api/monday/status').then(r => r.json()),
      fetch('/api/monday/schedule').then(r => r.json())
    ]);
    document.getElementById('health').textContent = h.status === 'ok' ? 'Saudável' : 'Atenção';
    document.getElementById('persistence').textContent = `Persistência atual: ${h.persistence}`;
    document.getElementById('monday').textContent = m.configured ? 'Conectado' : 'Não configurado';
    document.getElementById('schedule').textContent = `Sincronização: ${s.times.join(' · ')} · ${s.timezone}`;
    document.getElementById('updated').textContent = `Última verificação: ${new Date().toLocaleString('pt-BR')}`;
  } catch {
    document.getElementById('health').textContent = 'Indisponível';
  }
}
refresh();
setInterval(refresh, 30000);
