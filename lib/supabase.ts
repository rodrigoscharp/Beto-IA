import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!_client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("Supabase não configurado.");
    _client = createClient(url, key);
  }
  return _client;
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    return getClient()[prop as keyof SupabaseClient];
  },
});

export interface Memory {
  id?: string;
  content: string;
  category: string;
  created_at?: string;
}

export async function saveMemory(content: string, category = "general"): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from("jarvis_memories")
    .insert({ content, category });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function listMemories(limit = 30): Promise<Memory[]> {
  const { data, error } = await supabase
    .from("jarvis_memories")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return data as Memory[];
}

export async function deleteMemory(id: string): Promise<{ ok: boolean }> {
  const { data, error } = await supabase
    .from("jarvis_memories")
    .delete()
    .eq("id", id)
    .select("id");

  return { ok: !error && Array.isArray(data) && data.length > 0 };   // sem linha apagada (RLS, id velho) não é sucesso
}

/** Como listMemories, mas o erro do banco LANÇA (não vira "lista vazia": o Beto não pode dizer que não sabe nada nem cachear isso). */
export async function listMemoriesStrict(limit = 30): Promise<Memory[]> {
  const { data, error } = await supabase
    .from("jarvis_memories")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) throw new Error(error?.message ?? "Supabase sem resposta.");
  return data as Memory[];
}
