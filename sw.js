// Service worker do TTR Gestão Financeira: notificações push + cópia do app para abrir sem internet.
// Precisa ficar na MESMA pasta do HTML, no mesmo endereço https.
// Arquivos usados: icon-192.png (ícone grande) e badge-96.png (silhueta da barra de status do Android).
const CACHE = 'ttr-app-v15';
// Guarda o app e as bibliotecas externas JÁ NA INSTALAÇÃO (não só nas próximas visitas), para abrir sem internet desde o primeiro uso.
const LOCAIS = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'apple-ico.png', 'vendor/supabase.min.js', 'vendor/chart.umd.min.js'];
const EXTERNOS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.0',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'
];
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled([
      ...LOCAIS.map(u => fetch(u, { cache: 'reload' }).then(r => { if (r.ok) return cache.put(new URL(u, self.registration.scope).href, r); })),
      ...EXTERNOS.map(u => fetch(u, { mode: 'no-cors' }).then(r => cache.put(u, r)))
    ]);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('ttr-app-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));

// Abrir o app sem internet: tenta a rede primeiro (sempre a versão mais nova) e, se falhar, usa a cópia guardada da última vez.
// Não mexe nos dados do Supabase nem em nada que não seja GET.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || !/^https?:/.test(req.url)) return;
  const url = new URL(req.url);
  if (/\.supabase\.(co|in)$/.test(url.hostname)) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) {
        cache.put(req, res.clone()).catch(() => {});
        if (req.mode === 'navigate') cache.put(self.registration.scope, res.clone()).catch(() => {});
      }
      return res;
    } catch (err) {
      const guardado = await cache.match(req, { ignoreSearch: req.mode === 'navigate' })
        || (req.mode === 'navigate' && (await cache.match(self.registration.scope) || await cache.match(self.registration.scope + 'index.html')));
      if (guardado) return guardado;
      throw err;
    }
  })());
});

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
