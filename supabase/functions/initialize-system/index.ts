import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getUserOrgId } from '../_shared/tenant.ts';
import { DEFAULT_NINA_SETTINGS, DEFAULT_PIPELINE_STAGES, DEFAULT_TAG_DEFINITIONS, DEFAULT_TEAMS, DEFAULT_TEAM_FUNCTIONS, generateVerifyToken } from '../_shared/clinic-defaults.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};


Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Usuário vem do token de login (não confiar em user_id do corpo)
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    const { data: { user: authUser } } = await supabase.auth.getUser(token);
    const userId: string | null = authUser?.id || null;

    if (!userId) {
      console.error('[initialize-system] No authenticated user');
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Usuário não autenticado',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      );
    }

    console.log('[initialize-system] Initializing for user:', userId);

    const results = {
      profile: { initialized: false, existed: false },
      user_role: { assigned: false, role: '', existed: false },
      nina_settings: { initialized: false, existed: false, isFirstUser: false },
      pipeline_stages: { initialized: false, existed: false, count: 0 },
      tag_definitions: { initialized: false, existed: false, count: 0 },
      teams: { initialized: false, existed: false, count: 0 },
      team_functions: { initialized: false, existed: false, count: 0 },
      verify_token: { generated: false, token: '' },
    };

    // 0. Ensure profile exists for this user
    console.log('[initialize-system] Checking profile for user...');
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    if (existingProfile) {
      console.log('[initialize-system] Profile already exists for user');
      results.profile.existed = true;
    } else {
      console.log('[initialize-system] Creating profile for user...');
      const { data: userData } = await supabase.auth.admin.getUserById(userId);
      const fullName = userData?.user?.user_metadata?.full_name || 
                       userData?.user?.email?.split('@')[0] || 
                       'Usuário';
      
      const { error: profileError } = await supabase
        .from('profiles')
        .insert({
          user_id: userId,
          full_name: fullName,
        });

      if (profileError) {
        if (profileError.code === '23505') {
          console.log('[initialize-system] Profile already exists (race condition)');
          results.profile.existed = true;
        } else {
          console.error('[initialize-system] Error creating profile:', profileError);
        }
      } else {
        results.profile.initialized = true;
        console.log('[initialize-system] Profile created successfully');
      }
    }

    // Configuração padrão por clínica: cria na primeira vez que alguém da clínica entra
    const orgId = await getUserOrgId(supabase, userId);
    if (!orgId) {
      console.warn('[initialize-system] Usuário sem clínica vinculada:', userId);
      return new Response(
        JSON.stringify({ success: false, error: 'Usuário sem clínica vinculada', results }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
      );
    }

    const { data: membership } = await supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .maybeSingle();
    const appRole = membership?.role === 'admin' ? 'admin' : 'user';

    const { data: existingRole } = await supabase
      .from('user_roles')
      .select('id, role')
      .eq('user_id', userId)
      .maybeSingle();

    if (existingRole) {
      results.user_role.existed = true;
      results.user_role.role = existingRole.role;
    } else {
      const { error: roleError } = await supabase
        .from('user_roles')
        .insert({ user_id: userId, role: appRole });
      if (roleError && roleError.code !== '23505') {
        console.error('[initialize-system] Error assigning role:', roleError);
      } else {
        results.user_role.assigned = true;
        results.user_role.role = appRole;
      }
    }

    const { data: existingSettings } = await supabase
      .from('nina_settings')
      .select('id, whatsapp_verify_token')
      .eq('organization_id', orgId)
      .maybeSingle();

    if (existingSettings) {
      console.log('[initialize-system] Clínica já configurada:', orgId);
      results.nina_settings.existed = true;
      results.verify_token.token = existingSettings.whatsapp_verify_token || '';
    } else {
      console.log('[initialize-system] Criando configuração padrão da clínica:', orgId);
      results.nina_settings.isFirstUser = true;

      const newToken = generateVerifyToken();
      const { error: settingsError } = await supabase
        .from('nina_settings')
        .insert({
          ...DEFAULT_NINA_SETTINGS,
          whatsapp_verify_token: newToken,
          organization_id: orgId,
          user_id: null,
        });

      if (settingsError) {
        if (settingsError.code === '23505') {
          results.nina_settings.existed = true;
        } else {
          console.error('[initialize-system] Error creating nina_settings:', settingsError);
          throw settingsError;
        }
      } else {
        results.nina_settings.initialized = true;
        results.verify_token.generated = true;
        results.verify_token.token = newToken;
      }

      const seeds: Array<[keyof typeof results, string, Record<string, unknown>[]]> = [
        ['pipeline_stages', 'pipeline_stages', DEFAULT_PIPELINE_STAGES],
        ['tag_definitions', 'tag_definitions', DEFAULT_TAG_DEFINITIONS],
        ['teams', 'teams', DEFAULT_TEAMS],
        ['team_functions', 'team_functions', DEFAULT_TEAM_FUNCTIONS],
      ];

      for (const [key, table, rows] of seeds) {
        const { count } = await supabase
          .from(table)
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId);

        const entry = results[key] as { initialized: boolean; existed: boolean; count: number };
        if (count && count > 0) {
          entry.existed = true;
          continue;
        }

        const { error } = await supabase
          .from(table)
          .insert(rows.map((row) => ({ ...row, organization_id: orgId, user_id: null })));

        if (error) {
          console.error(`[initialize-system] Error creating ${table}:`, error);
        } else {
          entry.initialized = true;
          entry.count = rows.length;
        }
      }
    }

    console.log('[initialize-system] Initialization complete:', results);

    return new Response(
      JSON.stringify({
        success: true,
        message: results.nina_settings.isFirstUser 
          ? 'System initialized successfully (first user)' 
          : 'User profile initialized (system already configured)',
        results,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('[initialize-system] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
