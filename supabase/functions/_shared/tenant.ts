// Multi-clínica: as functions usam a service_role (ignora RLS), então toda
// leitura/escrita de dados de clínica precisa filtrar por organization_id.

export async function getUserOrgId(supabase: any, userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const { data } = await supabase
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.organization_id ?? null;
}

export async function getOrgSettings(supabase: any, orgId: string | null, columns = '*'): Promise<any | null> {
  if (!orgId) return null;
  const { data } = await supabase
    .from('nina_settings')
    .select(columns)
    .eq('organization_id', orgId)
    .maybeSingle();
  return data ?? null;
}
