// supabase/functions/enviar-notificacoes/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT")!,
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const dm = (iso: string) => iso.slice(8, 10) + "/" + iso.slice(5, 7);
function agora(fuso: string, quando = new Date()) {
  const data = new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(quando);
  const hora = new Intl.DateTimeFormat("en-GB", { timeZone: fuso, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(quando);
  return { data, hora };
}
function somaDias(iso: string, n: number) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// ícones: arquivos na mesma pasta do app (ajuste a URL base se precisar)
const BASE = Deno.env.get("APP_URL") || ""; // ex.: https://ttr-financas.github.io/ (com a barra no final)
const ICONES = { icon: BASE + "icon-192.png", badge: BASE + "badge-96.png" };

async function enviar(subs: any[], payload: object) {
  let ok = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ ...ICONES, ...payload }));
      ok++;
    } catch (e: any) {
      if (e.statusCode === 404 || e.statusCode === 410) await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      else console.error("push falhou", e.statusCode, e.body);
    }
  }
  return ok;
}

// ---- texto do aviso (função pura) ----
const plural = (n: number, s: string, p: string) => (n === 1 ? s : p);
function montarTexto(lista: any[], hoje: string, diasAntes: number, exato: boolean) {
  type G = { n: number; total: number; formas: Record<string, number>; itens: { nome: string; ref: string; data: string; falta: number }[] };
  const novo = (): G => ({ n: 0, total: 0, formas: {}, itens: [] });
  const grupos = { atr: novo(), prox: novo() };
  for (const p of lista) {
    const falta = Math.max(0, Number(p.valor_parcela) - Number(p.valor_pago || 0));
    if (falta < 0.005) continue;
    const dia = String(p.data_parcela).slice(0, 10);
    const g = dia < hoje ? grupos.atr : grupos.prox;
    g.n++; g.total += falta;
    const rot = [p.tipo_pagamento, p.nome_pagamento].filter(Boolean).join(" · ") || "Outros";
    g.formas[rot] = (g.formas[rot] || 0) + falta;
    g.itens.push({ nome: String(p.nome_compra || "Compra"), ref: String(p.parcela_referencia || ""), data: dia, falta });
  }
  const { atr, prox } = grupos;
  if (!atr.n && !prox.n) return null;

  const quando = diasAntes === 0 ? "hoje"
    : exato ? (diasAntes === 1 ? "amanhã" : `em ${diasAntes} dias`)
    : (diasAntes === 1 ? "até amanhã" : `em até ${diasAntes} dias`);

  // título curto (não corta no celular)
  let title: string;
  if (atr.n && prox.n) title = `⚠️ ${atr.n} ${plural(atr.n, "vencida", "vencidas")} · ⏰ ${prox.n} ${plural(prox.n, "vence", "vencem")} ${quando}`;
  else if (atr.n) title = `⚠️ ${atr.n} ${plural(atr.n, "parcela vencida", "parcelas vencidas")}`;
  else title = `⏰ ${prox.n} ${plural(prox.n, "parcela vence", "parcelas vencem")} ${quando}`;

  const bloco = (icone: string, rotulo: string, g: G) => {
    const linhas = [`${icone} ${rotulo} · ${brl(g.total)}`];
    const itens = g.itens.sort((a, b) => a.data.localeCompare(b.data));
    for (const it of itens.slice(0, 4)) linhas.push(`• ${it.nome}${it.ref ? " " + it.ref : ""} · ${dm(it.data)} · ${brl(it.falta)}`);
    if (itens.length > 4) linhas.push(`+ ${itens.length - 4} ${plural(itens.length - 4, "parcela", "parcelas")}`);
    const formas = Object.entries(g.formas).sort((a, b) => b[1] - a[1]);
    if (formas.length) linhas.push("Pagamento: " + formas.slice(0, 3).map(([k, v]) => `${k} ${brl(v)}`).join(" · ") + (formas.length > 3 ? ` +${formas.length - 3}` : ""));
    return linhas.join("\n");
  };

  // 1ª linha = resumo (é o que aparece na prévia com a notificação fechada)
  const partes: string[] = [`💰 Total em aberto: ${brl(atr.total + prox.total)}`];
  if (atr.n) partes.push(bloco("⚠️", plural(atr.n, "Vencida", "Vencidas"), atr));
  if (prox.n) partes.push(bloco("⏰", `${plural(prox.n, "Vence", "Vencem")} ${quando}`, prox));
  return { title, body: partes.join("\n\n") };
}

async function montarAviso(cfg: any, hoje: string) {
  const { data: perfil } = await admin.from("profiles").select("grupo_id").eq("id", cfg.user_id).maybeSingle();
  if (!perfil) return null;
  const { data: membros } = await admin.from("profiles").select("email").eq("grupo_id", perfil.grupo_id);
  const emails = (membros ?? []).map((m: any) => m.email);
  const diasAntes = Number(cfg.dias_antes) || 0;
  const alvo = somaDias(hoje, diasAntes);

  let q = admin.from("compras")
    .select("nome_compra,parcela_referencia,valor_parcela,valor_pago,tipo_pagamento,nome_pagamento,data_parcela")
    .in("criado_por", emails).eq("pagamento", false).or("status.is.null,status.neq.Estornado");
  q = cfg.incluir_atrasadas ? q.lte("data_parcela", alvo).gte("data_parcela", somaDias(hoje, -90)) : q.eq("data_parcela", alvo);
  const { data: parcelas } = await q.limit(2000);
  const texto = montarTexto(parcelas ?? [], hoje, diasAntes, !cfg.incluir_atrasadas);
  if (!texto) return null;
  return { ...texto, tag: "vencimentos", url: "./" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const body = await req.json().catch(() => ({}));

  // Teste manual (botão do app): exige usuário logado
  if (body.teste) {
    const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: { user } } = await admin.auth.getUser(jwt);
    if (!user) return json({ erro: "não autenticado" }, 401);
    const { data: subs } = await admin.from("push_subscriptions").select("*").eq("user_id", user.id);
    const enviados = await enviar(subs ?? [], {
      title: "Notificações ativadas ✅",
      body: "Tudo certo! Você receberá aqui os lembretes de vencimento das suas parcelas.",
      tag: "teste",
      url: "./",
    });
    return json({ enviados });
  }

  // Execução agendada (cron)
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return json({ erro: "proibido" }, 403);

  const { data: configs } = await admin.from("notificacoes_config").select("*").eq("ativo", true);
  let enviados = 0;
  for (const cfg of configs ?? []) {
    const fuso = cfg.fuso || "America/Sao_Paulo";
    const { data: hoje, hora } = agora(fuso);
    const horaCfg = String(cfg.hora || "10:00").slice(0, 5);
    if (cfg.ultimo_envio && agora(fuso, new Date(cfg.ultimo_envio)).data === hoje) continue; // já enviou hoje
    const atraso = minutos(hora) - minutos(horaCfg);
    if (atraso < 0 || atraso > 120) continue; // fora da janela do horário escolhido

    const aviso = await montarAviso(cfg, hoje);
    if (aviso) {
      const { data: subs } = await admin.from("push_subscriptions").select("*").eq("user_id", cfg.user_id);
      enviados += await enviar(subs ?? [], aviso);
    }
    await admin.from("notificacoes_config").update({ ultimo_envio: new Date().toISOString() }).eq("user_id", cfg.user_id);
  }
  return json({ ok: true, enviados });
});
