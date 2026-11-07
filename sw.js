// Service worker do Gestão Financeira: recebe e mostra as notificações push.
// Precisa ficar na MESMA pasta do HTML, no mesmo endereço https.
// Arquivos usados: icon-192.png (ícone grande) e badge-96.png (silhueta da barra de status do Android).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Gestão Financeira', {
    body: d.body || '',
    icon: 'icon-192.png',
    badge: 'badge-96.png',
    tag: d.tag || 'vencimentos',
    renotify: true,
    timestamp: Date.now(),
    lang: 'pt-BR',
    vibrate: [120, 60, 120],
    actions: [{ action: 'abrir', title: 'Abrir app' }],
    data: { url: d.url || './' }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const alvo = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(lista => {
    for (const c of lista) if ('focus' in c) return c.focus();
    return self.clients.openWindow(alvo);
  }));
});
