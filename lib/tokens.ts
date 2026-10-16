/* Refresh token do Google ou do Spotify: o do cookie primeiro; sem cookie, o guardado (cifrado) no servidor.
   O cookie é de cada origem, e no endereço local do Safari (https://localhost:3443, o proxy) ele não existe: o login
   do Google e do Spotify volta para a Vercel. Como o Beto tem um dono só, o token guardado vale para as duas origens.
   Sem imports: roda nos testes. */

export async function refreshTokenFor(
  cookieRt: string | undefined,
  loadStored: () => Promise<string | null>,
): Promise<string | null> {
  if (cookieRt) return cookieRt;
  try { return (await loadStored()) || null; }
  catch { return null; }
}
