import React from 'react';
import { Link } from 'react-router-dom';
import { useBrand } from '@/hooks/useBrand';

// Política de privacidade pública (/privacidade). A Meta pede este endereço no
// app do WhatsApp (URL da política de privacidade e instruções de exclusão de
// dados, âncora #exclusao). O nome e o contato vêm da marca configurada.

const UPDATED_AT = '22 de novembro de 2026';

const Section: React.FC<{ id?: string; title: string; children: React.ReactNode }> = ({ id, title, children }) => (
  <section id={id} className="flex flex-col gap-2 scroll-mt-6">
    <h2 className="text-base font-semibold text-foreground">{title}</h2>
    <div className="flex flex-col gap-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
  </section>
);

const Privacy: React.FC = () => {
  const { brand } = useBrand();
  const name = brand.name;
  const contacts = [
    brand.support_email ? `e-mail ${brand.support_email}` : null,
    brand.support_whatsapp ? `WhatsApp ${brand.support_whatsapp}` : null,
  ].filter(Boolean);
  const contactText = contacts.length
    ? `pelo ${contacts.join(' ou pelo ')}`
    : 'pelos canais de atendimento da clínica que falou com você';

  return (
    <div className="min-h-screen bg-background px-4 py-10" data-testid="privacy-page">
      <article className="mx-auto flex max-w-3xl flex-col gap-6">
        <header className="flex flex-col gap-1">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-accent">{name}</p>
          <h1 className="text-2xl font-semibold text-foreground">Política de Privacidade</h1>
          <p className="text-xs text-muted-foreground">Atualizada em {UPDATED_AT}</p>
        </header>

        <Section title="Quem somos">
          <p>
            {name} é uma plataforma de atendimento com inteligência artificial usada por clínicas de estética e beleza
            para responder mensagens no WhatsApp, agendar horários e enviar lembretes. Cada clínica é a controladora dos
            dados dos seus clientes; a plataforma trata esses dados em nome da clínica, conforme a Lei Geral de Proteção
            de Dados (LGPD, Lei 13.709/2018).
          </p>
        </Section>

        <Section title="Quais dados tratamos">
          <ul className="list-disc pl-5">
            <li>Clientes das clínicas: nome, número de WhatsApp, mensagens trocadas (texto, áudio e imagens), agendamentos e anotações do atendimento.</li>
            <li>Equipe das clínicas: nome, e-mail e dados de acesso ao sistema.</li>
            <li>Conexão com o WhatsApp: identificação da conta e do número da clínica na Meta e a chave de acesso, guardadas só no servidor e nunca exibidas na tela.</li>
          </ul>
        </Section>

        <Section title="Para que usamos">
          <ul className="list-disc pl-5">
            <li>Responder as mensagens que você manda para a clínica e tirar suas dúvidas.</li>
            <li>Marcar, confirmar e lembrar horários.</li>
            <li>Mandar mensagens de acompanhamento e novidades da clínica, quando você permitir.</li>
            <li>Manter a segurança, corrigir falhas e melhorar o atendimento.</li>
          </ul>
          <p>Não vendemos dados pessoais e não usamos as conversas para publicidade de terceiros.</p>
        </Section>

        <Section title="Com quem compartilhamos">
          <ul className="list-disc pl-5">
            <li>Meta (WhatsApp Business Platform), para enviar e receber as mensagens.</li>
            <li>Provedores de inteligência artificial, só o necessário para gerar as respostas.</li>
            <li>Serviços de hospedagem e e-mail que mantêm o sistema funcionando.</li>
            <li>Autoridades, quando a lei exigir.</li>
          </ul>
        </Section>

        <Section title="Por quanto tempo guardamos">
          <p>
            Enquanto a clínica usar a plataforma ou pelo prazo que a lei exigir. Quando a clínica encerra o uso ou você
            pede a exclusão, os dados são apagados ou anonimizados.
          </p>
        </Section>

        <Section title="Seus direitos">
          <p>
            Você pode pedir a qualquer momento para ver, corrigir, levar para outro serviço ou apagar seus dados, saber com
            quem eles foram compartilhados e deixar de receber mensagens. Para não receber mais mensagens de uma clínica,
            responda pedindo para parar ou avise a clínica, que marca o seu contato para não receber envios.
          </p>
        </Section>

        <Section id="exclusao" title="Como pedir a exclusão dos seus dados">
          <ol className="list-decimal pl-5">
            <li>Mande o pedido {contactText}, informando o número de WhatsApp usado nas conversas.</li>
            <li>Confirmamos que o número é seu.</li>
            <li>Apagamos as conversas, os agendamentos e o cadastro ligados a esse número em até 15 dias e avisamos quando terminar.</li>
          </ol>
          <p>Se você conectou o WhatsApp da sua clínica com o Facebook, pode também remover o acesso do app nas configurações da sua conta do Facebook, em Integrações comerciais.</p>
        </Section>

        <Section title="Segurança">
          <p>
            Os dados ficam em servidores protegidos, com acesso restrito por usuário e senha, conexão criptografada e
            separação entre clínicas. Chaves de acesso não aparecem na tela.
          </p>
        </Section>

        <Section title="Contato">
          <p>Dúvidas sobre esta política ou sobre seus dados: fale conosco {contactText}.</p>
        </Section>

        <footer className="border-t border-border/60 pt-4 text-xs text-muted-foreground">
          <Link to="/auth" className="underline underline-offset-2 hover:text-foreground">Voltar para o login</Link>
        </footer>
      </article>
    </div>
  );
};

export default Privacy;
