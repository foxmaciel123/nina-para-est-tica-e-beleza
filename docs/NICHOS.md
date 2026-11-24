# Tipo de negócio (nichos) e marca da empresa

O sistema atende 21 tipos de negócio. A lista mora em **um lugar só**:
`src/niches/registry.ts` (copiado igual para `supabase/functions/_shared/niches.ts`
com `npm run sync:niches`; o teste `e2e/niches.spec.ts` confere).

Cada nicho define: palavras da tela (cliente/paciente, cardápio/produtos…),
etapas do funil, nomes das etiquetas, equipes e funções, categorias do catálogo,
se tem Agenda e/ou Pedidos e o perfil do prompt da assistente.

## Onde a empresa escolhe

- Configuração Inicial, passo 1 "Seu negócio" (tipo, nome, logo, assistente).
- Configurações › "Seu negócio": trocar de tipo ou de logo, e **Desfazer troca**.

## O que o banco faz (migração `20261124100000_nichos_negocio.sql`)

- `nina_settings.business_niche` (padrão `estetica`: contas antigas não mudam),
  `company_logo_url` e `niche_previous` (foto de antes da última troca).
- `apply_business_niche(nicho, config, prompt)`: só admin; renomeia as etapas do
  funil pela ordem (mesmos ids, os cards não mudam), renomeia etiquetas pela chave,
  ativa as equipes do nicho e desativa as antigas que não têm ninguém. Nada é apagado.
- `undo_business_niche()`: volta funil, etiquetas, equipes, nicho e prompt.
- `org_profile()`: nome, assistente, nicho e logo para qualquer membro da empresa.
- Tabela `orders` (pedidos), com número por empresa e total calculado no banco.
- Logo da empresa no bucket `brand-assets`, pasta `org/<id da empresa>/` (só o admin dela).

## Assistente (nina-orchestrator)

- Sem prompt próprio, usa o prompt do nicho (estética continua com o prompt antigo).
- Nichos sem agenda não recebem as ferramentas de agendamento.
- Nichos com pedidos ganham a ferramenta `create_order`: o preço vem sempre do
  catálogo; item fora do catálogo entra como "preço a confirmar". Se o cliente
  mudar o pedido, o pedido em aberto da conversa é atualizado.

## Ordem para publicar

1. Backup do banco e migração na VPS + funções `nina-orchestrator` e `_shared`.
2. Depois, mesclar no `main` (a Cloudflare publica a tela sozinha).

A tela aguenta o servidor antigo (cai no modo estética e avisa), mas o certo é
publicar o servidor primeiro.

## Testar o banco

`psql -v ON_ERROR_STOP=1 -c 'BEGIN' -f supabase/tests/nichos_negocio.sql -c 'ROLLBACK'`
