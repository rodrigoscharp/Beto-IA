import test from "node:test";
import assert from "node:assert/strict";
import { refreshTokenFor } from "../lib/tokens.ts";

test("cookie presente: usa o cookie e nem consulta o servidor", async () => {
  let called = false;
  assert.equal(await refreshTokenFor("rt-cookie", async () => { called = true; return "rt-server"; }), "rt-cookie");
  assert.equal(called, false);
});

test("sem cookie (endereço local do Safari): usa o token guardado no servidor", async () => {
  assert.equal(await refreshTokenFor(undefined, async () => "rt-server"), "rt-server");
  assert.equal(await refreshTokenFor("", async () => "rt-server"), "rt-server");
});

test("sem cookie e sem token guardado, ou falha ao ler: null", async () => {
  assert.equal(await refreshTokenFor(undefined, async () => null), null);
  assert.equal(await refreshTokenFor(undefined, async () => { throw new Error("supabase fora"); }), null);
});
