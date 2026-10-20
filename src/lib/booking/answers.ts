/**
 * Server-side check of a booker's answers to an event type's custom
 * questions. The booking form enforces the same rules in the browser; this
 * is what holds for every other client (scripts, AI assistants).
 *
 * Encoding (one string per question id):
 *   text / textarea — free text
 *   select / radio  — exactly one of the question's options
 *   checkbox        — "on" when ticked, "" (or absent) when not
 */
import type { EventTypeQuestion } from '@prisma/client';

export type AnswerQuestion = Pick<EventTypeQuestion, 'id' | 'label' | 'kind' | 'required' | 'optionsJson'>;

export interface AnswerProblem {
  questionId: string;
  message: string;
}

export function questionOptions(optionsJson: string | null): string[] {
  if (!optionsJson) return [];
  try {
    const parsed: unknown = JSON.parse(optionsJson);
    return Array.isArray(parsed) ? parsed.filter((o): o is string => typeof o === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Returns the answers keyed by known question ids only (unknown ids are
 * dropped), plus every rule they break.
 */
export function checkAnswers(
  questions: readonly AnswerQuestion[],
  answers: Record<string, string>,
): { answers: Record<string, string>; problems: AnswerProblem[] } {
  const clean: Record<string, string> = {};
  const problems: AnswerProblem[] = [];
  for (const q of questions) {
    const raw = answers[q.id];
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (q.kind === 'checkbox') {
      if (value !== '' && value !== 'on') {
        problems.push({ questionId: q.id, message: `"${q.label}" must be "on" or empty.` });
        continue;
      }
      if (q.required && value !== 'on') {
        problems.push({ questionId: q.id, message: `"${q.label}" must be checked.` });
        continue;
      }
    } else if (value === '') {
      if (q.required) problems.push({ questionId: q.id, message: `"${q.label}" is required.` });
      continue;
    } else if (q.kind === 'select' || q.kind === 'radio') {
      const options = questionOptions(q.optionsJson);
      if (options.length > 0 && !options.includes(value)) {
        problems.push({ questionId: q.id, message: `"${q.label}" must be one of the listed options.` });
        continue;
      }
    }
    if (value !== '') clean[q.id] = value;
  }
  return { answers: clean, problems };
}
