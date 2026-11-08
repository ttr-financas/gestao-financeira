// Service worker do TTR Gestão Financeira: recebe e mostra as notificações push.
// Precisa ficar na MESMA pasta do HTML, no mesmo endereço https.
// Arquivos usados: icon-192.png (ícone grande) e badge-96.png (silhueta da barra de status do Android).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'TTR Gestão Financeira', {
    body: d.body || '',
    icon: d.icon || 'icon-192.png',
    badge: d.badge || 'badge-96.png',
    tag: d.tag || 'vencimentos',
    renotify: true,
    timestamp: Date.now(),
    lang: 'pt-BR',
    vibrate: [120, 60, 120],
    actions: [{ action: 'abrir', title: 'Abrir app' }],
    data: { url: d.url || './', aba: d.aba || '' }
  }));
});

// Ao tocar na notificação: abre/foca o app e, se o aviso for de uma aba específica (ex.: "A Receber"), vai direto para ela
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const dados = e.notification.data || {};
  const alvo = new URL(dados.url || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(lista => {
    for (const c of lista) {
      if ('focus' in c) {
        if (dados.aba) c.postMessage({ tipo: 'abrir-aba', aba: dados.aba });
        return c.focus();
      }
    }
    return self.clients.openWindow(alvo);
  }));
});
