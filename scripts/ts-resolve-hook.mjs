/* Só para os testes: o app importa "./arquivo" sem extensão (o Next resolve), mas o Node puro exige ".ts".
   Este gancho tenta de novo com ".ts" quando a resolução falha. Não faz parte do build. */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (e) {
    if (e && e.code === "ERR_MODULE_NOT_FOUND" && /^\.{1,2}\//.test(specifier) && !/\.[a-z]+$/i.test(specifier)) {
      return nextResolve(specifier + ".ts", context);
    }
    throw e;
  }
}
