import test from "node:test";
import assert from "node:assert/strict";
import { CALENDAR_TOOLS, executeCalendarTool } from "../lib/tools/calendar.ts";

/* Calendar falso em memória, com a mesma forma de resposta do Google. */
function fakeApi(seed = []) {
  const events = new Map(seed.map((e) => [e.id, structuredClone(e)]));
  const calls = [];
  let n = 100;
  return {
    calls, events,
    async list({ timeMin, timeMax, q, max }) {
      calls.push(["list", { timeMin, timeMax, q, max }]);
      const lo = Date.parse(timeMin), hi = Date.parse(timeMax);
      return [...events.values()].filter((e) => {
        if (!e.start) return true;   // evento quebrado vindo do Google: a API devolve mesmo assim
        const s = Date.parse(e.start.dateTime ?? `${e.start.date}T00:00:00-03:00`);
        const en = Date.parse(e.end.dateTime ?? `${e.end.date}T00:00:00-03:00`);
        return s < hi && en > lo && (!q || (e.summary ?? "").toLowerCase().includes(q.toLowerCase()));
      });
    },
    async get(id) { calls.push(["get", id]); return events.get(id) ?? null; },
    async insert(body, opts) { const id = `n${n++}`; calls.push(["insert", body, opts]); events.set(id, { id, ...body, start: { dateTime: `${body.start.dateTime}-03:00` }, end: { dateTime: `${body.end.dateTime}-03:00` } }); return events.get(id); },
    async patch(id, body, opts) {
      calls.push(["patch", id, body, opts]);
      const cur = events.get(id);
      const next = { ...cur, ...body };
      if (body.start) next.start = { dateTime: `${body.start.dateTime}-03:00` };
      if (body.end) next.end = { dateTime: `${body.end.dateTime}-03:00` };
      events.set(id, next); return next;
    },
    async remove(id, opts) { calls.push(["remove", id, opts]); events.delete(id); },
  };
}
const ev = (id, summary, s, e, extra = {}) => ({ id, summary, start: { dateTime: `${s}:00-03:00` }, end: { dateTime: `${e}:00-03:00` }, ...extra });
const ctx = (api, extra = {}) => ({ api, nowLocal: "2026-10-01T10:00", confirmed: false, userText: "marca uma reunião com joao@x.com e a@x.com na sexta", lastAssistant: "", writeIntent: true, state: { destructive: 0 }, ...extra });
const run = (name, args, c) => executeCalendarTool(name, args, c);

test("definições: 5 ferramentas, esquema válido, serializável e enxuto", () => {
  assert.deepEqual(CALENDAR_TOOLS.map((t) => t.function.name).sort(), ["create_event", "delete_event", "find_free_slots", "list_events", "update_event"]);
  for (const t of CALENDAR_TOOLS) {
    assert.equal(t.type, "function");
    assert.ok(t.function.description.length > 20);
    assert.equal(t.function.parameters.type, "object");
    for (const r of t.function.parameters.required ?? []) assert.ok(r in t.function.parameters.properties, `${t.function.name}.${r}`);
  }
  assert.ok(JSON.stringify(CALENDAR_TOOLS).length < 5000, String(JSON.stringify(CALENDAR_TOOLS).length));
});

test("sem login do Google: needsLogin", async () => {
  const r = await run("list_events", {}, ctx(null));
  assert.equal(r.needsLogin, true);
});

test("ferramenta desconhecida e argumentos que não são objeto viram erro", async () => {
  const api = fakeApi();
  assert.match((await run("hackear", {}, ctx(api))).error, /desconhecida/i);
  assert.match((await run("list_events", "oi", ctx(api))).error, /argumentos/i);
  assert.match((await run("list_events", null, ctx(api))).error, /argumentos/i);
});

test("list_events: padrão é de hoje até 7 dias, ordenado, com texto falado", async () => {
  const api = fakeApi([ev("b", "Depois", "2026-10-03T10:00", "2026-10-03T11:00"), ev("a", "Antes", "2026-10-02T15:00", "2026-10-02T16:00"), ev("fora", "Longe", "2026-10-20T10:00", "2026-10-20T11:00")]);
  const r = await run("list_events", {}, ctx(api));
  assert.deepEqual(r.events.map((e) => e.id), ["a", "b"]);
  assert.equal(r.events[0].when, "sexta-feira, 2 de outubro, das 15h às 16h");
  const [, p] = api.calls[0];
  assert.equal(p.timeMin, "2026-10-01T00:00:00-03:00");
  assert.equal(p.timeMax, "2026-10-08T00:00:00-03:00");
});

test("list_events: intervalo, busca e datas inválidas", async () => {
  const api = fakeApi([ev("a", "Dentista", "2026-10-05T09:00", "2026-10-05T10:00")]);
  const r = await run("list_events", { start: "2026-10-05", end: "2026-10-05", query: "dent" }, ctx(api));
  assert.equal(r.events.length, 1);
  assert.equal(api.calls[0][1].q, "dent");
  assert.match((await run("list_events", { start: "amanhã" }, ctx(api))).error, /YYYY-MM-DD/);
  assert.match((await run("list_events", { start: "2026-10-05", end: "2026-10-01" }, ctx(api))).error, /fim/i);
  assert.match((await run("list_events", { start: "2026-10-01", end: "2027-12-31" }, ctx(api))).error, /dias/i);
});

test("find_free_slots: janelas livres entre os compromissos do dia", async () => {
  const api = fakeApi([ev("a", "A", "2026-10-02T10:00", "2026-10-02T11:00"), ev("b", "B", "2026-10-02T14:00", "2026-10-02T15:00")]);
  const r = await run("find_free_slots", { date: "2026-10-02", duration_min: 60 }, ctx(api));
  assert.deepEqual(r.slots.map((s) => [s.start, s.end]), [["2026-10-02T09:00", "2026-10-02T10:00"], ["2026-10-02T11:00", "2026-10-02T14:00"], ["2026-10-02T15:00", "2026-10-02T18:00"]]);
  assert.ok(r.slots[0].when.includes("sexta-feira"));
});

test("find_free_slots: expediente customizado, sem horários, e validações", async () => {
  const api = fakeApi([ev("a", "A", "2026-10-02T08:00", "2026-10-02T19:00")]);
  const none = await run("find_free_slots", { date: "2026-10-02", duration_min: 30, from_hour: 8, to_hour: 12 }, ctx(api));
  assert.deepEqual(none.slots, []);
  assert.match(none.note, /nenhum/i);
  assert.match((await run("find_free_slots", { date: "2026-10-02", duration_min: 0 }, ctx(api))).error, /duração/i);
  assert.match((await run("find_free_slots", {}, ctx(api))).error, /date/i);
  assert.match((await run("find_free_slots", { date: "2026-10-02", from_hour: 18, to_hour: 9 }, ctx(api))).error, /hora/i);
});

test("create_event: cria com fuso de São Paulo, fim padrão de 1h e sem avisar ninguém", async () => {
  const api = fakeApi();
  const r = await run("create_event", { title: "Reunião com a Maria", start: "2026-10-02T15:00" }, ctx(api));
  assert.equal(r.status, "created");
  assert.equal(r.when, "sexta-feira, 2 de outubro, das 15h às 16h");
  const [, body, opts] = api.calls.find((c) => c[0] === "insert");
  assert.deepEqual(body.start, { dateTime: "2026-10-02T15:00:00", timeZone: "America/Sao_Paulo" });
  assert.deepEqual(body.end, { dateTime: "2026-10-02T16:00:00", timeZone: "America/Sao_Paulo" });
  assert.equal(body.summary, "Reunião com a Maria");
  assert.equal(opts.sendUpdates, "none");
});

test("create_event: duração, fim explícito, local, descrição e convidados (com aviso por email)", async () => {
  const api = fakeApi();
  await run("create_event", { title: "A", start: "2026-10-02T15:00", duration_min: 30 }, ctx(api));
  assert.equal(api.calls.find((c) => c[0] === "insert")[1].end.dateTime, "2026-10-02T15:30:00");
  const api2 = fakeApi();
  const r = await run("create_event", { title: "B", start: "2026-10-02T15:00", end: "2026-10-02T17:00", location: "Escritório", description: "Pauta", attendees: ["JOAO@x.com"] }, ctx(api2));
  const [, body, opts] = api2.calls.find((c) => c[0] === "insert");
  assert.equal(body.end.dateTime, "2026-10-02T17:00:00");
  assert.deepEqual([body.location, body.description, body.attendees], ["Escritório", "Pauta", [{ email: "JOAO@x.com" }]]);
  assert.equal(opts.sendUpdates, "all");
  assert.equal(r.status, "created");
});

test("create_event: conflito não cria; com ignore_conflicts cria", async () => {
  const api = fakeApi([ev("x", "Almoço", "2026-10-02T12:00", "2026-10-02T13:00")]);
  const r = await run("create_event", { title: "Call", start: "2026-10-02T12:30" }, ctx(api));
  assert.equal(r.status, "conflict");
  assert.deepEqual(r.conflicts.map((c) => c.title), ["Almoço"]);
  assert.ok(!api.calls.some((c) => c[0] === "insert"));
  const sem = await run("create_event", { title: "Call", start: "2026-10-02T12:30", ignore_conflicts: true }, ctx(api));
  assert.equal(sem.status, "conflict", "ignore_conflicts sem o 'sim' do chefe não vale");
  const r2 = await run("create_event", { title: "Call", start: "2026-10-02T12:30", ignore_conflicts: true },
    ctx(api, { confirmed: true, lastAssistant: "tem conflito com o almoco das 12h. marco mesmo assim?" }));
  assert.equal(r2.status, "created");
});

test("create_event: validações com mensagem clara para o modelo corrigir", async () => {
  const api = fakeApi();
  assert.match((await run("create_event", { start: "2026-10-02T15:00" }, ctx(api))).error, /title/i);
  assert.match((await run("create_event", { title: "x", start: "amanhã 15h" }, ctx(api))).error, /YYYY-MM-DDTHH:MM/);
  assert.match((await run("create_event", { title: "x" }, ctx(api))).error, /start/i);
  assert.match((await run("create_event", { title: "x", start: "2026-10-02T15:00", end: "2026-10-02T14:00" }, ctx(api))).error, /depois/i);
  assert.match((await run("create_event", { title: "x", start: "2026-10-02T15:00", duration_min: 99999 }, ctx(api))).error, /duração/i);
  assert.match((await run("create_event", { title: "x", start: "2026-10-02T15:00", attendees: ["não-é-email"] }, ctx(api))).error, /email/i);
  assert.match((await run("create_event", { title: "x", start: "2026-10-02T15:00", attendees: Array.from({ length: 11 }, (_, i) => `a${i}@x.com`) }, ctx(api, { userText: Array.from({ length: 11 }, (_, i) => `a${i}@x.com`).join(" ") }))).error, /convidados/i);
  assert.equal(api.calls.filter((c) => c[0] === "insert").length, 0);
});

test("update_event: mudar só o início mantém a duração e não pede confirmação sem convidados", async () => {
  const api = fakeApi([ev("e1", "Almoço", "2026-10-02T12:00", "2026-10-02T13:30")]);
  const r = await run("update_event", { event_id: "e1", start: "2026-10-03T12:00" }, ctx(api));
  assert.equal(r.status, "updated");
  const [, id, body, opts] = api.calls.find((c) => c[0] === "patch");
  assert.equal(id, "e1");
  assert.equal(body.start.dateTime, "2026-10-03T12:00:00");
  assert.equal(body.end.dateTime, "2026-10-03T13:30:00");
  assert.equal(opts.sendUpdates, "none");
  assert.equal(r.when, "sábado, 3 de outubro, das 12h às 13h30");
});

test("update_event: título, local, duração; sem nada para mudar; não encontrado; dia inteiro", async () => {
  const api = fakeApi([ev("e1", "Almoço", "2026-10-02T12:00", "2026-10-02T13:00"), { id: "dia", summary: "Feriado", start: { date: "2026-10-12" }, end: { date: "2026-10-13" } }]);
  await run("update_event", { event_id: "e1", title: "Almoço com a Ana", location: "Centro", duration_min: 90 }, ctx(api));
  const body = api.calls.find((c) => c[0] === "patch")[2];
  assert.deepEqual([body.summary, body.location, body.end.dateTime], ["Almoço com a Ana", "Centro", "2026-10-02T13:30:00"]);
  assert.match((await run("update_event", { event_id: "e1" }, ctx(api))).error, /nada/i);
  assert.match((await run("update_event", { event_id: "zzz", title: "x" }, ctx(api))).error, /encontrad/i);
  assert.match((await run("update_event", { event_id: "dia", start: "2026-10-13T10:00" }, ctx(api))).error, /dia inteiro/i);
  assert.match((await run("update_event", { title: "x" }, ctx(api))).error, /event_id/i);
});

test("update_event: evento com convidados exige confirmação do chefe (e só então avisa os convidados)", async () => {
  const guests = { attendees: [{ email: "eu@x.com", self: true }, { email: "joao@x.com" }] };
  const api = fakeApi([ev("e1", "Reunião", "2026-10-02T15:00", "2026-10-02T16:00", guests)]);
  const r = await run("update_event", { event_id: "e1", start: "2026-10-03T15:00" }, ctx(api));
  assert.equal(r.status, "needs_confirmation");
  assert.ok(!api.calls.some((c) => c[0] === "patch"));
  const r2 = await run("update_event", { event_id: "e1", start: "2026-10-03T15:00" }, ctx(api, { confirmed: true, lastAssistant: "posso remarcar a reuniao de amanha as 15h para sabado?" }));
  assert.equal(r2.status, "updated");
  assert.equal(api.calls.find((c) => c[0] === "patch")[3].sendUpdates, "all");
});

test("update_event: conflito no novo horário avisa (ignorando o próprio evento)", async () => {
  const api = fakeApi([ev("e1", "A", "2026-10-02T12:00", "2026-10-02T13:00"), ev("e2", "B", "2026-10-03T12:00", "2026-10-03T13:00")]);
  const r = await run("update_event", { event_id: "e1", start: "2026-10-03T12:30" }, ctx(api));
  assert.equal(r.status, "conflict");
  assert.deepEqual(r.conflicts.map((c) => c.id), ["e2"]);
  const same = await run("update_event", { event_id: "e1", start: "2026-10-02T12:15" }, ctx(api));
  assert.equal(same.status, "updated", "mexer dentro do próprio horário não é conflito");
});

test("delete_event: SEMPRE pede confirmação; só apaga com confirmed", async () => {
  const api = fakeApi([ev("e1", "Reunião com o João", "2026-10-02T15:00", "2026-10-02T16:00")]);
  const r = await run("delete_event", { event_id: "e1" }, ctx(api));
  assert.equal(r.status, "needs_confirmation");
  assert.equal(r.event.title, "Reunião com o João");
  assert.match(r.instruction, /confirm/i);
  assert.ok(api.events.has("e1"));
  assert.ok(!api.calls.some((c) => c[0] === "remove"));
  const r2 = await run("delete_event", { event_id: "e1" }, ctx(api, { confirmed: true, lastAssistant: "cancelo a reuniao com o joao amanha as 15h?" }));
  assert.equal(r2.status, "deleted");
  assert.ok(!api.events.has("e1"));
});

test("delete_event: não encontrado e sem event_id; convidados são avisados só depois de confirmar", async () => {
  const api = fakeApi([ev("g", "Com convidado", "2026-10-02T15:00", "2026-10-02T16:00", { attendees: [{ email: "a@x.com" }] })]);
  const yes = { confirmed: true, lastAssistant: "cancelo o com convidado de amanha as 15h?" };
  assert.match((await run("delete_event", { event_id: "nada" }, ctx(api, yes))).error, /encontrad/i);
  assert.match((await run("delete_event", {}, ctx(api, yes))).error, /event_id/i);
  await run("delete_event", { event_id: "g" }, ctx(api, yes));
  assert.equal(api.calls.find((c) => c[0] === "remove")[2].sendUpdates, "all");
});

test("create_event: só convida emails que o próprio chefe disse na conversa (convite malicioso não vira convidado)", async () => {
  const api = fakeApi();
  const r = await run("create_event", { title: "x", start: "2026-10-02T15:00", attendees: ["atacante@evil.com"] }, ctx(api, { userText: "marca uma reunião amanhã às 15h" }));
  assert.match(r.error, /chefe/i);
  assert.ok(!api.calls.some((c) => c[0] === "insert"), "nada foi criado nem enviado");
  const ok = await run("create_event", { title: "x", start: "2026-10-02T15:00", attendees: ["Ana.Silva@Empresa.com.br"] }, ctx(api, { userText: "convida a ana.silva@empresa.com.br" }));
  assert.equal(ok.status, "created");
});

test("create_event: sem texto do chefe no contexto, nenhum convidado passa", async () => {
  const api = fakeApi();
  const r = await run("create_event", { title: "x", start: "2026-10-02T15:00", attendees: ["a@x.com"] }, ctx(api, { userText: "" }));
  assert.match(r.error, /chefe/i);
});

const GUEST = { attendees: [{ email: "eu@x.com", self: true }, { email: "joao@x.com" }] };

test("escrita só com intenção do chefe: leitura continua, criar/mudar/apagar são recusados", async () => {
  const api = fakeApi([ev("e1", "Reunião com o João", "2026-10-02T15:00", "2026-10-02T16:00")]);
  const c = ctx(api, { writeIntent: false });
  assert.ok((await run("list_events", {}, c)).events);
  assert.ok((await run("find_free_slots", { date: "2026-10-02" }, c)).slots);
  for (const [n, a] of [["create_event", { title: "x", start: "2026-10-02T17:00" }], ["update_event", { event_id: "e1", title: "y" }], ["delete_event", { event_id: "e1" }]]) {
    assert.match((await run(n, a, c)).error, /não pediu/i, n);
  }
  assert.ok(!api.calls.some((x) => ["insert", "patch", "remove"].includes(x[0])));
});

test("confirmação presa ao evento: a pergunta do Beto precisa citar o título (e o horário se o título for curto)", async () => {
  const api = fakeApi([ev("e1", "Reunião com o João", "2026-10-02T15:00", "2026-10-02T16:00"), ev("e2", "Call", "2026-10-02T11:00", "2026-10-02T12:00")]);
  const generica = await run("delete_event", { event_id: "e1" }, ctx(api, { confirmed: true, lastAssistant: "quer que eu mude de musica?" }));
  assert.equal(generica.status, "needs_confirmation", "pergunta sem o título não confirma");
  const outro = await run("delete_event", { event_id: "e1" }, ctx(api, { confirmed: true, lastAssistant: "cancelo a call das 11h?" }));
  assert.equal(outro.status, "needs_confirmation", "confirmou OUTRO evento");
  const curto = await run("delete_event", { event_id: "e2" }, ctx(api, { confirmed: true, lastAssistant: "cancelo a call de amanha?" }));
  assert.equal(curto.status, "needs_confirmation", "título curto sem horário não basta");
  const ok = await run("delete_event", { event_id: "e2" }, ctx(api, { confirmed: true, lastAssistant: "cancelo a call de amanha as 11h?" }));
  assert.equal(ok.status, "deleted");
  assert.ok(api.events.has("e1"));
});

test("só UMA ação destrutiva por requisição (nada de apagar várias com um 'sim')", async () => {
  const api = fakeApi([ev("a", "Reunião com o João", "2026-10-02T15:00", "2026-10-02T16:00"), ev("b", "Reunião com o João", "2026-10-02T15:00", "2026-10-02T16:00")]);
  const c = ctx(api, { confirmed: true, lastAssistant: "cancelo a reuniao com o joao de amanha as 15h?" });
  assert.equal((await run("delete_event", { event_id: "a" }, c)).status, "deleted");
  assert.match((await run("delete_event", { event_id: "b" }, c)).error, /uma ação destrutiva/i);
  assert.ok(api.events.has("b"));
});

test("série recorrente inteira não é apagada nem alterada; ocorrência avisa que é recorrente", async () => {
  const api = fakeApi([ev("serie", "Daily", "2026-10-02T09:00", "2026-10-02T09:15", { recurrence: ["RRULE:FREQ=DAILY"] }),
    ev("serie_20261002", "Daily", "2026-10-02T09:00", "2026-10-02T09:15", { recurringEventId: "serie" })]);
  const c = ctx(api, { confirmed: true, lastAssistant: "cancelo o daily das 9h?" });
  assert.match((await run("delete_event", { event_id: "serie" }, c)).error, /série/i);
  assert.match((await run("update_event", { event_id: "serie", title: "x" }, c)).error, /série/i);
  assert.ok(api.events.has("serie"));
  const lst = await run("list_events", { start: "2026-10-02", end: "2026-10-02" }, c);
  assert.ok(lst.events.find((e) => e.id === "serie_20261002").recurring);
});

test("create_event no passado é recusado (resolveu 'sexta' errado)", async () => {
  const api = fakeApi();
  assert.match((await run("create_event", { title: "x", start: "2026-09-25T15:00" }, ctx(api))).error, /passou/i);
  assert.equal((await run("create_event", { title: "x", start: "2026-10-01T10:30" }, ctx(api))).status, "created");
  assert.match((await run("update_event", { event_id: "n", start: "2026-09-25T15:00" }, ctx(fakeApi([ev("n", "N", "2026-10-02T15:00", "2026-10-02T16:00")])))).error, /passou/i);
});

test("convidado por voz: 'arroba' e 'ponto' viram email; igualdade exata (ana@x.com não vale para ana@x.com.br)", async () => {
  const api = fakeApi();
  const dito = ctx(api, { userText: "marca com a joão arroba empresa ponto com ponto br amanhã" });
  assert.equal((await run("create_event", { title: "x", start: "2026-10-02T15:00", attendees: ["joao@empresa.com.br"] }, dito)).status, "created");
  const quase = await run("create_event", { title: "x", start: "2026-10-02T16:00", attendees: ["ana@x.com"] }, ctx(api, { userText: "convida a ana@x.com.br" }));
  assert.match(quase.error, /chefe/i);
});

test("evento sem horário válido vindo do Google não derruba a listagem", async () => {
  const api = fakeApi([ev("ok", "Bom", "2026-10-02T10:00", "2026-10-02T11:00"), { id: "ruim", summary: "Quebrado" }]);
  const r = await run("list_events", { start: "2026-10-02", end: "2026-10-02" }, ctx(api));
  assert.deepEqual(r.events.map((e) => e.id), ["ok"]);
});

test("convite de outro organizador (sem lista de convidados) exige confirmação para remarcar", async () => {
  const api = fakeApi([ev("o", "Planejamento do Pedro", "2026-10-02T15:00", "2026-10-02T16:00", { organizer: { email: "pedro@x.com", self: false } })]);
  const r = await run("update_event", { event_id: "o", start: "2026-10-03T15:00" }, ctx(api));
  assert.equal(r.status, "needs_confirmation");
});

/* ── Segunda revisão: a confirmação amarra ao evento CERTO (título, dia e horário) ─────────────── */

const yesCtx = (api, lastAssistant, extra = {}) => ctx(api, { confirmed: true, lastAssistant, ...extra });

test("confirmar exige citar o DIA: a pergunta sem data não apaga", async () => {
  const api = fakeApi([ev("a", "Reunião semanal", "2026-10-02T15:00", "2026-10-02T16:00")]);
  const r = await run("delete_event", { event_id: "a" }, yesCtx(api, "cancelo a reuniao semanal das 15h?"));
  assert.equal(r.status, "needs_confirmation");
  assert.ok(api.events.has("a"));
  const ok = await run("delete_event", { event_id: "a" }, yesCtx(api, "cancelo a reuniao semanal de amanha as 15h?"));
  assert.equal(ok.status, "deleted");
});

test("o 'sim' não apaga a ocorrência de OUTRO dia (mesmo título, mesmo dia da semana, outra data)", async () => {
  const api = fakeApi([ev("sex2", "Reunião semanal", "2026-10-02T15:00", "2026-10-02T16:00"), ev("sex9", "Reunião semanal", "2026-10-09T15:00", "2026-10-09T16:00")]);
  const pergunta = "cancelo a reuniao semanal desta sexta, 2 de outubro, as 15h?";
  const errado = await run("delete_event", { event_id: "sex9" }, yesCtx(api, pergunta));
  assert.equal(errado.status, "needs_confirmation", "o id do dia 9 não foi o citado");
  assert.ok(api.events.has("sex9"));
  const certo = await run("delete_event", { event_id: "sex2" }, yesCtx(api, pergunta));
  assert.equal(certo.status, "deleted");
});

test("título curto: 'Call' às 15h em outro dia não é o evento da pergunta", async () => {
  const api = fakeApi([ev("a", "Call", "2026-10-02T15:00", "2026-10-02T16:00"), ev("b", "Call", "2026-10-20T15:00", "2026-10-20T16:00")]);
  const q = "cancelo a call de sexta, 2/10, as 15h?";
  assert.equal((await run("delete_event", { event_id: "b" }, yesCtx(api, q))).status, "needs_confirmation");
  assert.equal((await run("delete_event", { event_id: "a" }, yesCtx(api, q))).status, "deleted");
});

test("título é comparado por palavra inteira: 'Reunion' não confirma o evento 'union'", async () => {
  const api = fakeApi([ev("u", "union", "2026-10-02T09:00", "2026-10-02T10:00")]);
  const r = await run("delete_event", { event_id: "u" }, yesCtx(api, "cancelo a reunion de amanha as 9h?"));
  assert.equal(r.status, "needs_confirmation");
});

test("ignore_conflicts: título que some depois de limpar a pontuação nunca é aceito; precisa citar título e horário", async () => {
  const api = fakeApi([ev("x", ".", "2026-10-02T12:00", "2026-10-02T13:00"), ev("y", "Almoço", "2026-10-03T12:00", "2026-10-03T13:00")]);
  const pontuacao = await run("create_event", { title: "Call", start: "2026-10-02T12:30", ignore_conflicts: true }, yesCtx(api, "tem conflito. marco mesmo assim?"));
  assert.equal(pontuacao.status, "conflict");
  const semHora = await run("create_event", { title: "Call", start: "2026-10-03T12:30", ignore_conflicts: true }, yesCtx(api, "tem conflito com o almoco. marco mesmo assim?"));
  assert.equal(semHora.status, "conflict", "sem o horário do conflito");
  const ok = await run("create_event", { title: "Call", start: "2026-10-03T12:30", ignore_conflicts: true }, yesCtx(api, "tem conflito com o almoco das 12h. marco mesmo assim?"));
  assert.equal(ok.status, "created");
});

test("o horário pode vir em vários formatos: 12:00, meio-dia, 9h, 09h, 3 da tarde, 15h30, 15:30", async () => {
  const mk = (id, title, start) => ev(id, title, start, start.replace(/T(\d\d)/, (m, h) => `T${String(Number(h) + 1).padStart(2, "0")}`));
  const casos = [
    ["Almoço do dia", "2026-10-02T12:00", "cancelo o almoco do dia de amanha as 12:00?"],
    ["Almoço do dia", "2026-10-02T12:00", "cancelo o almoco do dia de amanha ao meio-dia?"],
    ["Consulta médica", "2026-10-02T09:00", "cancelo a consulta medica de amanha as 9h?"],
    ["Consulta médica", "2026-10-02T09:00", "cancelo a consulta medica de amanha as 09h?"],
    ["Café da tarde", "2026-10-02T15:00", "cancelo o cafe da tarde de amanha as 3 da tarde?"],
    ["Reunião de alinhamento", "2026-10-02T15:30", "cancelo a reuniao de alinhamento de amanha as 15h30?"],
    ["Reunião de alinhamento", "2026-10-02T15:30", "cancelo a reuniao de alinhamento de amanha as 15:30?"],
    ["Reunião de alinhamento", "2026-10-02T15:30", "cancelo a reuniao de alinhamento de amanha as 15 e meia?"],
  ];
  for (const [title, start, q] of casos) {
    const api = fakeApi([mk("e", title, start)]);
    assert.equal((await run("delete_event", { event_id: "e" }, yesCtx(api, q))).status, "deleted", q);
  }
});

test("data citada de várias formas: 'amanhã', 'hoje', '2 de outubro', '2/10', 'dia 2', 'sexta' (dentro da semana)", async () => {
  const mk = (q, nowLocal = "2026-10-01T10:00", start = "2026-10-02T15:00") => [fakeApi([ev("e", "Reunião com o João", start, start.replace("T15", "T16"))]), q, nowLocal];
  for (const [q, now, start] of [
    ["cancelo a reuniao com o joao de amanha as 15h?"],
    ["cancelo a reuniao com o joao em 2 de outubro as 15h?"],
    ["cancelo a reuniao com o joao dia 2/10 as 15h?"],
    ["cancelo a reuniao com o joao no dia 2 as 15h?"],
    ["cancelo a reuniao com o joao de sexta as 15h?"],
    ["cancelo a reuniao com o joao de hoje as 15h?", "2026-10-02T08:00"],
  ]) {
    const [api, , nowLocal] = mk(q, now, start);
    assert.equal((await run("delete_event", { event_id: "e" }, yesCtx(api, q, { nowLocal }))).status, "deleted", q);
  }
  // evento a mais de uma semana: 'sexta' sozinha é ambígua, precisa da data
  const far = fakeApi([ev("e", "Reunião com o João", "2026-10-16T15:00", "2026-10-16T16:00")]);
  assert.equal((await run("delete_event", { event_id: "e" }, yesCtx(far, "cancelo a reuniao com o joao de sexta as 15h?"))).status, "needs_confirmation");
  assert.equal((await run("delete_event", { event_id: "e" }, yesCtx(far, "cancelo a reuniao com o joao de sexta, 16 de outubro, as 15h?"))).status, "deleted");
});

test("o resultado needs_confirmation já traz a frase pronta com título, dia e horário", async () => {
  const api = fakeApi([ev("e", "Reunião com o João", "2026-10-02T15:00", "2026-10-02T16:00")]);
  const r = await run("delete_event", { event_id: "e" }, ctx(api));
  assert.match(r.ask_with, /Reunião com o João/);
  assert.match(r.ask_with, /2 de outubro/);
  assert.match(r.ask_with, /15h/);
  assert.match(r.ask_with, /\?$/);
});

test("no máximo 2 remarcações/renomeações por requisição (evento sem convidados também)", async () => {
  const api = fakeApi([ev("a", "A", "2026-10-02T10:00", "2026-10-02T11:00"), ev("b", "B", "2026-10-02T12:00", "2026-10-02T13:00"), ev("c", "C", "2026-10-02T14:00", "2026-10-02T15:00")]);
  const c = ctx(api);
  assert.equal((await run("update_event", { event_id: "a", title: "A2" }, c)).status, "updated");
  assert.equal((await run("update_event", { event_id: "b", title: "B2" }, c)).status, "updated");
  assert.match((await run("update_event", { event_id: "c", title: "C2" }, c)).error, /duas/i);
  assert.equal(api.events.get("c").summary, "C");
});
