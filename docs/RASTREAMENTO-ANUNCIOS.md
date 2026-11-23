# Rastreamento de anúncios (tela "Anúncios")

Para o gestor de tráfego saber qual anúncio traz cliente, agendamento, venda e faturamento.

## Como funciona

1. **Origem do lead.** Quando a cliente clica num anúncio de clique para o WhatsApp, a 1ª mensagem chega com o
   objeto `referral` da Meta (id do anúncio, título, link e `ctwa_clid`). O `whatsapp-webhook` chama
   `record_lead_touch`, que grava o clique em `lead_touches` e no contato (`contacts.ad_*`).
   * O 1º anúncio fica para sempre no contato (atribuição). O último `ctwa_clid` também é guardado (para devolver a venda).
   * WhatsApp por QR (Evolution): lê `contextInfo.externalAdReply`; nem toda versão do WhatsApp manda.
   * Clientes que chegaram antes desta versão aparecem como "Sem anúncio".
2. **Vendas.** Tabela `sales`.
   * Card do Funil movido para "Ganho" com valor cria a venda sozinho (sai do Ganho, a venda some).
   * Botão **Registrar venda** (ícone de cifrão) no Atendimento cria vendas avulsas (cliente que volta e compra de novo).
3. **Investimento (só leitura).** Em Anúncios > Conectar conta de anúncios: ID da conta + chave com `ads_read`.
   A função `meta-ads-sync` busca de hora em hora (cron `nina-meta-ads-sync`) o gasto por anúncio e por dia, com
   nomes de campanha, conjunto e anúncio. A 1ª busca puxa 30 dias; depois, os últimos 7 (a Meta ajusta números atrasados).
4. **Relatório.** `ads_report(de, até)`: leads, agendamentos (sem cancelados), vendas e faturamento por anúncio,
   mais a linha "Sem anúncio". A tela calcula CPL, custo por venda, ROAS e uma leitura rápida (Escalar, Se paga,
   Lead sem venda, Sem lead, Prejuízo). Datas no fuso de São Paulo.
5. **Devolver a venda para a Meta (desligado por padrão).** Com a opção ligada, cada venda de cliente com
   `ctwa_clid` entra em `meta_conversion_events` e a `meta-ads-sync` envia como `Purchase`
   (`action_source: business_messaging`, `messaging_channel: whatsapp`) para o conjunto de dados da conta do WhatsApp.
   Precisa: WhatsApp na API oficial, permissão `whatsapp_business_manage_events` (Acesso Avançado) e o recurso de
   nível de acesso da Marketing API aprovados no app da Meta. Até lá a fila mostra o erro e tenta 5 vezes.

## Chave da Meta Ads (recomendado)

Gerenciador de Negócios da clínica > Usuários do sistema > adicionar (Funcionário) > Atribuir ativos: a conta de
anúncios (Ver desempenho) > Gerar token com `ads_read` e validade "Nunca". A chave fica só no servidor
(`meta_ads_connections`, sem acesso pelo painel) e nunca volta para a tela.

## Publicar na VPS

1. Backup do banco.
2. Migration `supabase/migrations/20261124000000_rastreamento_anuncios.sql`.
3. Funções: `meta-ads-sync` (nova), `whatsapp-webhook` e `evolution-webhook` (alteradas). Reiniciar `supabase-edge-functions`.
4. A tela publica sozinha quando o PR é mesclado no main (Cloudflare).

Teste do banco (termina com ROLLBACK, não grava nada): `psql -v ON_ERROR_STOP=1 -f supabase/tests/rastreamento_anuncios.sql`.
