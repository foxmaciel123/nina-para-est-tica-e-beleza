-- Segurança: app_config só para a dona da plataforma.
--
-- app_config guarda a chave mestra do banco (service_role_key, usada pelos
-- crons), a URL do servidor e o App Secret da Meta. A política antiga deixava
-- ler e ALTERAR a tabela qualquer usuário com papel global 'admin' em
-- user_roles — e toda dona de clínica criada pelo painel recebe esse papel.
-- Ou seja: qualquer cliente conseguia pegar a chave mestra (acesso a todas as
-- empresas) ou trocar a URL dos crons.
--
-- Agora só is_platform_owner() lê/escreve pela API. Os crons continuam
-- funcionando: leem por app_config_get() (SECURITY DEFINER, sem grant para
-- anon/authenticated). As funções do servidor usam a service role.
--
-- Desfazer (não recomendado): recriar as políticas "Admins can ... app_config"
-- de 20261004200000_self_host_bootstrap.sql.

REVOKE ALL ON TABLE public.app_config FROM anon;
REVOKE ALL ON FUNCTION public.app_config_get(text) FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Admins can read app_config" ON public.app_config;
DROP POLICY IF EXISTS "Admins can write app_config" ON public.app_config;
DROP POLICY IF EXISTS "Platform owner reads app_config" ON public.app_config;
DROP POLICY IF EXISTS "Platform owner writes app_config" ON public.app_config;

CREATE POLICY "Platform owner reads app_config" ON public.app_config
  FOR SELECT TO authenticated
  USING (public.is_platform_owner());

CREATE POLICY "Platform owner writes app_config" ON public.app_config
  FOR ALL TO authenticated
  USING (public.is_platform_owner())
  WITH CHECK (public.is_platform_owner());
