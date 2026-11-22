# Botão "Conectar WhatsApp" (Cadastro Incorporado da Meta)

Um app da Meta da plataforma conecta o WhatsApp de todas as clínicas. A clínica
clica no botão, entra com o Facebook dela, escolhe a empresa e o número, e a
Nina recebe um código que a função `whatsapp-connect` troca pelo token da clínica.

## Peças

| Onde | O quê |
|---|---|
| `app_config` | `meta_app_id`, `meta_es_config_id` (públicos), `meta_app_secret`, `meta_webhook_verify_token` (secretos) |
| Painel do Dono → App WhatsApp (`/dono/whatsapp`) | salva App ID, Configuration ID e App Secret; mostra URL e token do webhook |
| `ConnectWhatsAppButton` | abre o FB.login com `config_id`, `response_type: 'code'`, ouve o `postMessage` `WA_EMBEDDED_SIGNUP` (waba_id, phone_number_id) |
| `whatsapp-connect` | troca o código (`oauth/access_token`), descobre IDs se faltarem (`debug_token`), `POST /{waba}/subscribed_apps`, `POST /{phone}/register` com PIN aleatório (não na coexistência), grava em `nina_settings` |
| `whatsapp-webhook` | aceita também o token de verificação da plataforma; a assinatura usa o App Secret gravado na clínica (o mesmo da plataforma) |

Coexistência (o número continua no WhatsApp Business do celular): botão
"Já uso o WhatsApp Business no celular" manda `featureType: 'whatsapp_business_app_onboarding'`
e o número não é registrado.

## Configuração única na Meta (dono da plataforma)

1. Business Manager da Pixel Pro verificado (Central de segurança).
2. Meta for Developers → criar app tipo **Empresa** no BM da Pixel Pro → produto **WhatsApp**.
3. Produto **Login do Facebook para Empresas** → Configurações → criar configuração do tipo
   "Cadastro incorporado do WhatsApp" com as permissões `whatsapp_business_management` e
   `whatsapp_business_messaging` → copiar o **Configuration ID**.
4. Login do Facebook para Empresas → Configurações: domínio da Nina em
   "Domínios permitidos para o SDK do JavaScript" e "Allowed domains".
5. App → Configurações → Básico: App ID, App Secret, URL da política de privacidade
   (`https://<domínio da Nina>/privacidade`) e URL de instruções de exclusão de dados
   (`https://<domínio da Nina>/privacidade#exclusao`).
6. Nina → Painel do Dono → App WhatsApp: colar App ID, Configuration ID e App Secret.
7. Meta → app → WhatsApp → Configuração → Webhook: URL e token mostrados na Nina, assinar `messages`.
8. Pedir acesso avançado das duas permissões (análise do app, com vídeo do fluxo) e o
   status de Tech Provider. Antes da aprovação o botão só funciona para quem tem função no app.

## Antes da aprovação da Meta (análise do app)

- Enquanto a análise do app não for aprovada, o app fica com acesso padrão: só quem tem função no app consegue conectar, e só pelo botão verde (modo nuvem) com um número que não tem WhatsApp.
- O botão "Já uso o WhatsApp Business no celular" (coexistência) devolve o erro #3441107 ("This partner's app isn't set up yet to connect WhatsApp Business app numbers") até o Provedor de Tecnologia concluir a análise do app.
- Webhook: além de `messages`, deixe assinados `account_update`, `history`, `smb_app_state_sync` e `smb_message_echoes` (exigidos pela coexistência; a função ignora esses campos por enquanto).
- A análise pede 2 vídeos: (1) `whatsapp_business_messaging`: a Nina enviando uma mensagem e o WhatsApp recebendo; (2) `whatsapp_business_management`: criar um modelo de mensagem pela Nina (DISPARO > Modelos de mensagem > Criar modelo). Também exige ícone 1024x1024, política de privacidade e categoria.
