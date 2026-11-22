// Contas da tela "Anúncios": junta as linhas do relatório (uma por anúncio)
// por campanha, conjunto ou anúncio e calcula CPL, ROAS e custo por venda.

export type AdsReportRow = {
  ad_id: string | null;
  ad_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  headline: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  meta_conversations: number;
  leads: number;
  appointments: number;
  sales: number;
  revenue: number;
};

export type Level = 'campaign' | 'adset' | 'ad';

export type Group = {
  key: string;
  name: string;
  subtitle: string | null;
  organic: boolean;
  spend: number;
  impressions: number;
  clicks: number;
  metaConversations: number;
  leads: number;
  appointments: number;
  sales: number;
  revenue: number;
};

export const ORGANIC_KEY = '__organic__';

export const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);

export const cpl = (g: Pick<Group, 'spend' | 'leads'>) => ratio(g.spend, g.leads);
export const costPerSale = (g: Pick<Group, 'spend' | 'sales'>) => ratio(g.spend, g.sales);
export const roas = (g: Pick<Group, 'revenue' | 'spend'>) => ratio(g.revenue, g.spend);
export const leadToSale = (g: Pick<Group, 'sales' | 'leads'>) => ratio(g.sales, g.leads);

const toNum = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0)) || 0;

export function normalizeRow(r: any): AdsReportRow {
  return {
    ad_id: r.ad_id ?? null,
    ad_name: r.ad_name ?? null,
    adset_id: r.adset_id ?? null,
    adset_name: r.adset_name ?? null,
    campaign_id: r.campaign_id ?? null,
    campaign_name: r.campaign_name ?? null,
    headline: r.headline ?? null,
    spend: toNum(r.spend),
    impressions: toNum(r.impressions),
    clicks: toNum(r.clicks),
    meta_conversations: toNum(r.meta_conversations),
    leads: toNum(r.leads),
    appointments: toNum(r.appointments),
    sales: toNum(r.sales),
    revenue: toNum(r.revenue),
  };
}

function groupIdentity(r: AdsReportRow, level: Level): { key: string; name: string; subtitle: string | null } {
  if (!r.ad_id) return { key: ORGANIC_KEY, name: 'Sem anúncio (orgânico ou indicação)', subtitle: null };
  // Anúncio que trouxe lead mas não está na conta conectada (ou conta ainda não conectada)
  const unknown = !r.campaign_id;
  const adLabel = r.ad_name || r.headline || `Anúncio ${r.ad_id}`;
  if (level === 'ad' || unknown) {
    return {
      key: `ad:${r.ad_id}`,
      name: adLabel,
      subtitle: unknown
        ? (r.headline && r.headline !== adLabel ? r.headline : `ID ${r.ad_id}`)
        : [r.campaign_name, r.adset_name].filter(Boolean).join(' › ') || null,
    };
  }
  if (level === 'adset') {
    return { key: `adset:${r.adset_id}`, name: r.adset_name || `Conjunto ${r.adset_id}`, subtitle: r.campaign_name };
  }
  return { key: `campaign:${r.campaign_id}`, name: r.campaign_name || `Campanha ${r.campaign_id}`, subtitle: null };
}

export function groupRows(rows: AdsReportRow[], level: Level): Group[] {
  const map = new Map<string, Group>();
  for (const r of rows) {
    const id = groupIdentity(r, level);
    const g = map.get(id.key) ?? {
      ...id,
      organic: id.key === ORGANIC_KEY,
      spend: 0, impressions: 0, clicks: 0, metaConversations: 0,
      leads: 0, appointments: 0, sales: 0, revenue: 0,
    };
    g.spend += r.spend;
    g.impressions += r.impressions;
    g.clicks += r.clicks;
    g.metaConversations += r.meta_conversations;
    g.leads += r.leads;
    g.appointments += r.appointments;
    g.sales += r.sales;
    g.revenue += r.revenue;
    map.set(id.key, g);
  }
  // Orgânico sempre por último; o resto pelo faturamento, depois investimento
  return [...map.values()].sort((a, b) => {
    if (a.organic !== b.organic) return a.organic ? 1 : -1;
    return b.revenue - a.revenue || b.spend - a.spend || b.leads - a.leads;
  });
}

export function totals(rows: AdsReportRow[], onlyAds = false) {
  return rows
    .filter((r) => !onlyAds || r.ad_id)
    .reduce(
      (t, r) => ({
        spend: t.spend + r.spend,
        leads: t.leads + r.leads,
        appointments: t.appointments + r.appointments,
        sales: t.sales + r.sales,
        revenue: t.revenue + r.revenue,
        metaConversations: t.metaConversations + r.meta_conversations,
      }),
      { spend: 0, leads: 0, appointments: 0, sales: 0, revenue: 0, metaConversations: 0 },
    );
}

export type Verdict = { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral'; hint: string };

// Leitura rápida para o gestor de tráfego (não é ordem: é um sinal para olhar)
export function verdict(g: Group, avgCpl: number | null): Verdict | null {
  if (g.organic) return null;
  const r = roas(g);
  if (g.spend <= 0) return g.sales > 0 ? { label: 'Vendeu', tone: 'good', hint: 'Teve venda; sem investimento no período (ou conta não conectada).' } : null;
  if (r !== null && r >= 3) return { label: 'Escalar', tone: 'good', hint: 'Retorno de 3x ou mais: candidato a aumentar orçamento.' };
  if (r !== null && r >= 1) return { label: 'Se paga', tone: 'neutral', hint: 'Fatura mais do que gasta. Otimize antes de escalar.' };
  if (g.leads === 0 && avgCpl !== null && g.spend >= avgCpl * 2) {
    return { label: 'Sem lead', tone: 'bad', hint: 'Já gastou 2x o custo médio por lead sem trazer ninguém. Trocar criativo ou pausar.' };
  }
  if (g.sales === 0 && g.leads >= 10) {
    return { label: 'Lead sem venda', tone: 'warn', hint: 'Traz conversa mas não fecha: revisar público, oferta ou atendimento.' };
  }
  if (r !== null && r < 1 && g.sales > 0) return { label: 'Prejuízo', tone: 'warn', hint: 'Vendeu menos do que gastou no período.' };
  return null;
}

export const brl = (v: number | null, digits = 2) =>
  v === null ? '–' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: digits, maximumFractionDigits: digits });

export const int = (v: number) => Math.round(v).toLocaleString('pt-BR');

export const roasLabel = (v: number | null) => (v === null ? '–' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}x`);

export const pct = (v: number | null) => (v === null ? '–' : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
