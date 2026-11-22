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
5. App → Configurações → Básico: App ID, App Secret, URL de privacidade.
6. Nina → Painel do Dono → App WhatsApp: colar App ID, Configuration ID e App Secret.
7. Meta → app → WhatsApp → Configuração → Webhook: URL e token mostrados na Nina, assinar `messages`.
8. Pedir acesso avançado das duas permissões (análise do app, com vídeo do fluxo) e o
   status de Tech Provider. Antes da aprovação o botão só funciona para quem tem função no app.
