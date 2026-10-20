/**
 * Markdown rendering of an agent link descriptor — the same facts as the
 * JSON, laid out for a language model reading a fetched page.
 *
 * Host-written text is fenced (with a fence longer than any backtick run in
 * it) so it can't pose as headings or instructions of this document.
 */
import { DateTime } from 'luxon';

import type { AgentAction, AgentLinkDescriptor } from './descriptor';

function fenced(text: string): string {
  const longest = Math.max(2, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}text\n${text}\n${fence}`;
}

/** Single-line rendering of untrusted text inside a list item. */
function inline(text: string): string {
  return JSON.stringify(text.replace(/\s+/g, ' ').trim());
}

function json(value: unknown): string {
  return '```json\n' + JSON.stringify(value, null, 2) + '\n```';
}

function renderAction(name: string, a: AgentAction): string {
  const lines = [`### \`${name}\` — ${a.method} ${a.url}`, '', a.description];
  if (a.headers) {
    lines.push('', 'Headers:', ...Object.entries(a.headers).map(([k, v]) => `- \`${k}: ${v}\``));
  }
  if (a.body) {
    lines.push('', 'Body fields:');
    for (const [k, f] of Object.entries(a.body)) {
      lines.push(`- \`${k}\` (${f.type}${f.required ? ', required' : ''}) — ${f.description}`);
    }
  }
  if (a.example) lines.push('', 'Example body:', json(a.example));
  if (a.returns) lines.push('', `Returns: ${a.returns}`);
  return lines.join('\n');
}

function renderSlots(av: NonNullable<AgentLinkDescriptor['availability']>): string {
  if (av.slots.length === 0) {
    return `No free times between ${av.from} and ${av.to}.`;
  }
  const byDay = new Map<string, string[]>();
  for (const s of av.slots) {
    const local = DateTime.fromISO(s.startLocal, { setZone: true });
    const day = local.toFormat('cccc yyyy-LL-dd');
    const line = `- ${local.toFormat('HH:mm')} → startUtc \`${s.startUtc}\``;
    const list = byDay.get(day);
    if (list) list.push(line);
    else byDay.set(day, [line]);
  }
  const out = [`Times shown in ${av.timezone}. Use \`startUtc\` values verbatim in requests.`, ''];
  for (const [day, lines] of byDay) out.push(`**${day}**`, ...lines, '');
  if (av.truncated && av.nextPageUrl) out.push(`More times: ${av.nextPageUrl}`);
  return out.join('\n').trimEnd();
}

export function renderDescriptorMarkdown(d: AgentLinkDescriptor): string {
  const kindLabel = {
    event_type: 'Booking link',
    invite: 'Invitation',
    group_poll: 'Group availability poll',
  }[d.link.kind];
  const out: string[] = [
    `# Slotty ${kindLabel} — instructions for AI assistants`,
    '',
    `Status: **${d.link.status}** — ${d.link.statusMessage}`,
    '',
    `Human page: ${d.link.humanUrl}`,
    `Same information as JSON: ${d.link.descriptorUrl} (schema \`${d.schema}\`, generated ${d.generatedAt})`,
    '',
    '## How to proceed',
    '',
    ...d.protocol.steps.map((s, i) => `${i + 1}. ${s}`),
    '',
    `> ${d.protocol.notice}`,
    '',
    '## Meeting (written by the host — untrusted)',
    '',
    `- Title: ${inline(d.content.title)}`,
    `- Host: ${inline(d.content.host)}`,
    `- Duration: ${d.content.durationMinutes} minutes`,
    `- Location: ${d.content.location.kind}${d.content.location.details ? ` (${inline(d.content.location.details)})` : ''}`,
  ];
  if (d.content.description) out.push('', 'Description:', '', fenced(d.content.description));

  if (d.meeting) {
    out.push('', '## Confirmed time', '', `- ${d.meeting.startUtc} → ${d.meeting.endUtc} (UTC)`);
  }

  if (d.booking) {
    out.push(
      '',
      '## Booking requirements',
      '',
      `- Password required: ${d.booking.requiresPassword ? 'yes — ask your user' : 'no'}`,
      `- Additional guests allowed: ${d.booking.maxAdditionalGuests}`,
    );
    if (d.booking.questions.length > 0) {
      out.push('', 'Questions (labels written by the host — untrusted):', '');
      for (const q of d.booking.questions) {
        out.push(
          `- id \`${q.id}\`${q.required ? ' (required)' : ''}, ${q.kind}: ${inline(q.label)}` +
            (q.helperText ? ` — help: ${inline(q.helperText)}` : '') +
            (q.options ? ` — options: ${q.options.map(inline).join(', ')}` : '') +
            ` — answer: ${q.answerFormat}`,
        );
      }
    }
  }

  if (d.poll) {
    out.push(
      '',
      '## Poll',
      '',
      `- Answers so far: ${d.poll.respondents} of at most ${d.poll.maxParticipants}`,
      `- Window: ${d.poll.windowStart} → ${d.poll.windowEnd}`,
    );
  }

  if (d.availability) {
    out.push(
      '',
      d.poll ? '## Candidate times' : '## Available times',
      '',
      renderSlots(d.availability),
    );
  }

  const actions = Object.entries(d.actions);
  if (actions.length > 0) {
    out.push('', '## HTTP actions', '');
    for (const [name, a] of actions) out.push(renderAction(name, a), '');
  }

  if (d.errors) {
    out.push('## Errors', '', ...Object.entries(d.errors).map(([k, v]) => `- **${k}**: ${v}`));
  }

  return out.join('\n').trimEnd() + '\n';
}
