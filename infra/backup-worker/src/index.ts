// Recebe os backups diários do banco da Nina (VPS) e guarda no Cloudflare R2.
//
//   PUT    /backups/<arquivo>.sql.gz   envia um backup
//   GET    /backups                   lista os backups
//   GET    /backups/<arquivo>.sql.gz   baixa um backup (para restaurar)
//
// Todas as rotas exigem "Authorization: Bearer <BACKUP_TOKEN>" (secret do Worker).
// A cada envio, apaga backups com mais de RETENTION_DAYS dias.

interface Env {
  BACKUPS: R2Bucket;
  BACKUP_TOKEN: string;
  RETENTION_DAYS?: string;
}

const NAME_RE = /^nina-\d{8}-\d{4}\.sql\.gz$/;

function authorized(req: Request, env: Env): boolean {
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!env.BACKUP_TOKEN || token.length !== env.BACKUP_TOKEN.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ env.BACKUP_TOKEN.charCodeAt(i);
  return diff === 0;
}

async function prune(env: Env) {
  const days = Number(env.RETENTION_DAYS ?? '30');
  const cutoff = Date.now() - days * 86_400_000;
  let cursor: string | undefined;
  do {
    const page = await env.BACKUPS.list({ prefix: 'backups/', cursor });
    const old = page.objects.filter((o) => o.uploaded.getTime() < cutoff).map((o) => o.key);
    if (old.length) await env.BACKUPS.delete(old);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (!authorized(req, env)) return new Response('Unauthorized', { status: 401 });

    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'backups') return new Response('Not found', { status: 404 });
    const name = parts[1];

    if (req.method === 'GET' && !name) {
      const page = await env.BACKUPS.list({ prefix: 'backups/' });
      const items = page.objects
        .map((o) => ({ name: o.key.slice('backups/'.length), size: o.size, uploaded: o.uploaded.toISOString() }))
        .sort((a, b) => b.name.localeCompare(a.name));
      return Response.json(items);
    }

    if (!name || !NAME_RE.test(name)) return new Response('Nome de arquivo inválido', { status: 400 });
    const key = `backups/${name}`;

    if (req.method === 'PUT') {
      if (!req.body) return new Response('Arquivo vazio', { status: 400 });
      await env.BACKUPS.put(key, req.body, { httpMetadata: { contentType: 'application/gzip' } });
      ctx.waitUntil(prune(env));
      return new Response('ok', { status: 201 });
    }

    if (req.method === 'GET') {
      const obj = await env.BACKUPS.get(key);
      if (!obj) return new Response('Não encontrado', { status: 404 });
      return new Response(obj.body, { headers: { 'content-type': 'application/gzip', 'content-disposition': `attachment; filename="${name}"` } });
    }

    return new Response('Método não permitido', { status: 405 });
  },
};
