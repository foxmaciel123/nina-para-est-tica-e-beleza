#!/bin/bash
# Configura o servidor de e-mail (SMTP) do login do sistema.
# Rode na VPS:  bash /opt/nina/configurar-email.sh
# A senha é digitada aqui e fica só no /opt/nina/.env (nunca passa pelo chat).
set -e
cd /opt/nina

echo "Configuração do e-mail de recuperação de senha"
echo "Use os dados SMTP do seu provedor (ex.: e-mail da Hostinger: smtp.hostinger.com, porta 465)."
read -rp "Servidor SMTP: " SMTP_HOST
read -rp "Porta [465]: " SMTP_PORT; SMTP_PORT=${SMTP_PORT:-465}
read -rp "Usuário (e-mail completo): " SMTP_USER
read -rsp "Senha (não aparece ao digitar): " SMTP_PASS; echo
read -rp "Remetente [${SMTP_USER}]: " SMTP_FROM; SMTP_FROM=${SMTP_FROM:-$SMTP_USER}
read -rp "Nome do remetente [Atendimento]: " SMTP_NAME; SMTP_NAME=${SMTP_NAME:-Atendimento}

cp .env ".env.bak.$(date +%Y%m%d%H%M%S)"
set_env() {
  local key=$1 value=$2
  local escaped
  escaped=$(printf '%s' "$value" | sed -e 's/[\/&|]/\\&/g')
  if grep -q "^${key}=" .env; then sed -i "s|^${key}=.*|${key}=${escaped}|" .env; else echo "${key}=${value}" >> .env; fi
}
set_env SMTP_HOST "$SMTP_HOST"
set_env SMTP_PORT "$SMTP_PORT"
set_env SMTP_USER "$SMTP_USER"
set_env SMTP_PASS "$SMTP_PASS"
set_env SMTP_ADMIN_EMAIL "$SMTP_FROM"
set_env SMTP_SENDER_NAME "\"$SMTP_NAME\""
chmod 600 .env

docker compose -p nina up -d auth >/dev/null 2>&1
echo "Pronto. Teste em: tela de login → digite um e-mail com acesso → Esqueci minha senha."
