/**
 * Descriptor URLs for the human booking pages, for `<link rel="alternate">`
 * and the on-page hint.
 */
import { getPublicUrl } from '@/lib/site-url/store';

export interface AgentLinks {
  json: string;
  markdown: string;
}

async function build(path: string): Promise<AgentLinks> {
  const json = `${await getPublicUrl()}${path}`;
  return { json, markdown: `${json}?format=markdown` };
}

export function agentLinksForSlug(slug: string): Promise<AgentLinks> {
  return build(`/api/agent/links/${encodeURIComponent(slug)}`);
}

export function agentLinksForInvite(token: string): Promise<AgentLinks> {
  return build(`/api/agent/invites/${encodeURIComponent(token)}`);
}

/** Next.js `metadata.alternates` for a booking page. */
export function agentAlternates(links: AgentLinks) {
  return { types: { 'application/json': links.json, 'text/markdown': links.markdown } };
}
