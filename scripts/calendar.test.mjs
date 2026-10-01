import test from "node:test";
import assert from "node:assert/strict";
import {
  validLocal, localToEpoch, epochToLocal, addMinutes, normalizeEvent, spokenWhen, overlaps, conflictsFor, freeSlots,
} from "../lib/calendar.ts";

test("validLocal aceita YYYY-MM-DDTHH:MM (com ou sem segundos) e recusa lixo e datas impossíveis", () => {
  assert.equal(validLocal("2026-10-02T15:00"), true);
  assert.equal(validLocal("2026-10-02T15:00:30"), true);
  for (const bad of ["2026-10-02", "amanhã 15h", "2026-13-02T10:00", "2026-02-30T10:00", "2026-10-02T25:00", "2026-10-02T10:61", "", "2026-10-02 15:00"]) {
    assert.equal(validLocal(bad), false, bad);
  }
});

test("conversão local <-> época usa São Paulo (-03:00) e é inversa", () => {
  assert.equal(localToEpoch("2026-10-02T15:00"), Date.parse("2026-10-02T18:00:00Z"));
  assert.equal(epochToLocal(Date.parse("2026-10-02T18:00:00Z")), "2026-10-02T15:00");
  assert.equal(epochToLocal(localToEpoch("2026-12-31T23:59")), "2026-12-31T23:59");
});

test("addMinutes cruza a meia-noite e o fim do mês", () => {
  assert.equal(addMinutes("2026-10-02T15:00", 60), "2026-10-02T16:00");
  assert.equal(addMinutes("2026-10-31T23:30", 60), "2026-11-01T00:30");
  assert.equal(addMinutes("2026-10-02T09:00", -30), "2026-10-02T08:30");
});

test("normalizeEvent: evento com horário, em UTC e em -03:00, vira horário local de São Paulo", () => {
  const a = normalizeEvent({ id: "1", summary: "Reunião", start: { dateTime: "2026-10-02T15:00:00-03:00" }, end: { dateTime: "2026-10-02T16:00:00-03:00" } });
  assert.deepEqual([a.id, a.title, a.start, a.end, a.allDay], ["1", "Reunião", "2026-10-02T15:00", "2026-10-02T16:00", false]);
  const b = normalizeEvent({ id: "2", summary: "UTC", start: { dateTime: "2026-10-02T18:00:00Z" }, end: { dateTime: "2026-10-02T19:30:00Z" } });
  assert.deepEqual([b.start, b.end], ["2026-10-02T15:00", "2026-10-02T16:30"]);
});

test("normalizeEvent: dia inteiro (fim exclusivo), sem título, convidados, cancelado, livre e recusado", () => {
  const day = normalizeEvent({ id: "d", start: { date: "2026-10-02" }, end: { date: "2026-10-03" } });
  assert.deepEqual([day.allDay, day.title, day.start, day.end], [true, "Sem título", "2026-10-02T00:00", "2026-10-03T00:00"]);
  const guests = normalizeEvent({ id: "g", summary: "x", start: { dateTime: "2026-10-02T10:00:00-03:00" }, end: { dateTime: "2026-10-02T11:00:00-03:00" },
    attendees: [{ email: "eu@x.com", self: true }, { email: "joao@x.com" }, { email: "ana@x.com" }] });
  assert.deepEqual([guests.attendees, guests.hasOthers], [2, true]);
  const solo = normalizeEvent({ id: "s", summary: "x", start: { dateTime: "2026-10-02T10:00:00-03:00" }, end: { dateTime: "2026-10-02T11:00:00-03:00" }, attendees: [{ email: "eu@x.com", self: true }] });
  assert.deepEqual([solo.attendees, solo.hasOthers], [0, false]);
  const base = { start: { dateTime: "2026-10-02T10:00:00-03:00" }, end: { dateTime: "2026-10-02T11:00:00-03:00" } };
  assert.equal(normalizeEvent({ id: "c", status: "cancelled", ...base }).busy, false);
  assert.equal(normalizeEvent({ id: "t", transparency: "transparent", ...base }).busy, false);
  assert.equal(normalizeEvent({ id: "r", ...base, attendees: [{ self: true, responseStatus: "declined" }] }).busy, false);
  assert.equal(normalizeEvent({ id: "ok", ...base }).busy, true);
});

test("spokenWhen: dia da semana, data e horário em português", () => {
  assert.equal(spokenWhen("2026-10-02T15:00", "2026-10-02T16:00", false), "sexta-feira, 2 de outubro, das 15h às 16h");
  assert.equal(spokenWhen("2026-10-02T09:30", "2026-10-02T10:15", false), "sexta-feira, 2 de outubro, das 9h30 às 10h15");
  assert.equal(spokenWhen("2026-10-02T00:00", "2026-10-03T00:00", true), "sexta-feira, 2 de outubro, o dia todo");
  assert.equal(spokenWhen("2026-10-02T00:00", "2026-10-05T00:00", true), "de sexta-feira, 2 de outubro até domingo, 4 de outubro");
  assert.equal(spokenWhen("2026-10-02T23:00", "2026-10-03T01:00", false), "sexta-feira, 2 de outubro, das 23h até 1h de sábado, 3 de outubro");
});

test("overlaps: encostar não é sobrepor", () => {
  const a = { start: "2026-10-02T10:00", end: "2026-10-02T11:00" };
  assert.equal(overlaps(a, { start: "2026-10-02T10:30", end: "2026-10-02T11:30" }), true);
  assert.equal(overlaps(a, { start: "2026-10-02T11:00", end: "2026-10-02T12:00" }), false);
  assert.equal(overlaps(a, { start: "2026-10-02T09:00", end: "2026-10-02T10:00" }), false);
  assert.equal(overlaps(a, { start: "2026-10-02T09:00", end: "2026-10-02T12:00" }), true);
});

const mk = (id, start, end, extra = {}) => ({ id, title: id, start, end, allDay: false, location: null, attendees: 0, hasOthers: false, meetLink: null, spoken: "", busy: true, ...extra });

test("conflictsFor ignora evento de dia inteiro, livre e cancelado", () => {
  const evs = [
    mk("a", "2026-10-02T10:00", "2026-10-02T11:00"),
    mk("dia", "2026-10-02T00:00", "2026-10-03T00:00", { allDay: true }),
    mk("livre", "2026-10-02T10:00", "2026-10-02T11:00", { busy: false }),
  ];
  assert.deepEqual(conflictsFor(evs, "2026-10-02T10:30", "2026-10-02T11:30").map((e) => e.id), ["a"]);
  assert.deepEqual(conflictsFor(evs, "2026-10-02T11:00", "2026-10-02T12:00"), []);
});

test("freeSlots: janelas entre os eventos dentro do expediente", () => {
  const evs = [mk("a", "2026-10-02T10:00", "2026-10-02T11:00"), mk("b", "2026-10-02T14:00", "2026-10-02T15:00")];
  const r = freeSlots({ events: evs, fromDate: "2026-10-02", toDate: "2026-10-02", durationMin: 60, dayStartHour: 9, dayEndHour: 18, max: 5, nowLocal: "2026-10-01T08:00" });
  assert.deepEqual(r.map((s) => [s.start, s.end]), [
    ["2026-10-02T09:00", "2026-10-02T10:00"], ["2026-10-02T11:00", "2026-10-02T14:00"], ["2026-10-02T15:00", "2026-10-02T18:00"],
  ]);
});

test("freeSlots: duração maior que a janela descarta a janela", () => {
  const evs = [mk("a", "2026-10-02T10:00", "2026-10-02T11:00"), mk("b", "2026-10-02T14:00", "2026-10-02T15:00")];
  const r = freeSlots({ events: evs, fromDate: "2026-10-02", toDate: "2026-10-02", durationMin: 150, dayStartHour: 9, dayEndHour: 18, max: 5, nowLocal: "2026-10-01T08:00" });
  assert.deepEqual(r.map((s) => [s.start, s.end]), [["2026-10-02T11:00", "2026-10-02T14:00"], ["2026-10-02T15:00", "2026-10-02T18:00"]]);
});

test("freeSlots: não oferece horário que já passou hoje", () => {
  const r = freeSlots({ events: [], fromDate: "2026-10-02", toDate: "2026-10-02", durationMin: 60, dayStartHour: 9, dayEndHour: 18, max: 5, nowLocal: "2026-10-02T13:20" });
  assert.deepEqual(r.map((s) => [s.start, s.end]), [["2026-10-02T13:20", "2026-10-02T18:00"]]);
});

test("freeSlots: vários dias, limite de resultados e dia lotado", () => {
  const full = mk("tudo", "2026-10-02T08:00", "2026-10-02T19:00");
  const r = freeSlots({ events: [full], fromDate: "2026-10-02", toDate: "2026-10-05", durationMin: 60, dayStartHour: 9, dayEndHour: 18, max: 2, nowLocal: "2026-10-01T08:00" });
  assert.equal(r.length, 2);
  assert.equal(r[0].start, "2026-10-03T09:00");
});

test("freeSlots: evento que atravessa a janela do dia é cortado", () => {
  const night = mk("n", "2026-10-01T22:00", "2026-10-02T09:30");
  const r = freeSlots({ events: [night], fromDate: "2026-10-02", toDate: "2026-10-02", durationMin: 30, dayStartHour: 9, dayEndHour: 12, max: 5, nowLocal: "2026-10-01T08:00" });
  assert.deepEqual(r.map((s) => [s.start, s.end]), [["2026-10-02T09:30", "2026-10-02T12:00"]]);
});

test("freeSlots: intervalo de datas inválido ou invertido não quebra", () => {
  assert.deepEqual(freeSlots({ events: [], fromDate: "2026-10-05", toDate: "2026-10-02", durationMin: 60, dayStartHour: 9, dayEndHour: 18, max: 5, nowLocal: "2026-10-01T08:00" }), []);
  assert.deepEqual(freeSlots({ events: [], fromDate: "x", toDate: "y", durationMin: 60, dayStartHour: 9, dayEndHour: 18, max: 5, nowLocal: "2026-10-01T08:00" }), []);
});
