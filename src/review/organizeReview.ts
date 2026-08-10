import type { AiReviewOutline, ReviewFileChange, RiskLevel, SemanticReview, SemanticSection } from '@/review/types';

type Category = {
  id: string;
  title: string;
  intent: string;
  focus: string;
  risk: RiskLevel;
  prompts: string[];
  area: string;
  rank: number;
};

const categories: Category[] = [
  {
    id: 'data-model',
    title: 'Establish the data model and persistence',
    intent: 'Define the durable data shape and ensure existing data can move safely into it.',
    focus: 'Check invariants, migration safety, defaults, indexes and compatibility with existing records.',
    risk: 'high',
    area: 'Data model',
    rank: 1,
    prompts: ['Is the migration safe on existing data?', 'Do defaults preserve current behaviour?', 'Are new constraints and indexes justified?']
  },
  {
    id: 'domain',
    title: 'Define the domain behaviour',
    intent: 'Change the rule or state transition at the centre of this merge request.',
    focus: 'Check allowed state transitions, invariants and error paths before reviewing consumers.',
    risk: 'high',
    area: 'Domain behaviour',
    rank: 2,
    prompts: ['What invariant is this enforcing?', 'Which transition or edge case is still unrepresented?', 'Could retries duplicate this operation?']
  },
  {
    id: 'workflow',
    title: 'Update the application workflow',
    intent: 'Wire the changed behaviour through the application or integration flow.',
    focus: 'Trace success, failure, retries and the boundary between external work and persistence.',
    risk: 'high',
    area: 'Workflow',
    rank: 3,
    prompts: ['What happens if the external operation succeeds but persistence fails?', 'Is this operation transactional enough?', 'Who owns retry and idempotency?']
  },
  {
    id: 'api',
    title: 'Expose the change through the API',
    intent: 'Adapt the transport or contract layer that makes the changed behaviour available to callers.',
    focus: 'Check backwards compatibility, validation, permissions and what clients observe on failure.',
    risk: 'medium',
    area: 'API contract',
    rank: 4,
    prompts: ['Is this contract backwards compatible?', 'Does this endpoint enforce the same permission as adjacent endpoints?', 'What response reaches a caller on failure?']
  },
  {
    id: 'interface',
    title: 'Present the changed behaviour in the interface',
    intent: 'Update the user-facing surface that consumes the new behaviour.',
    focus: 'Check loading, empty, failure and refresh states—not only the intended happy path.',
    risk: 'medium',
    area: 'Interface',
    rank: 5,
    prompts: ['What does a user see while data is stale or loading?', 'Is the failure state understandable and recoverable?', 'Does this handle older API data during rollout?']
  },
  {
    id: 'tests',
    title: 'Verify the behaviour with tests',
    intent: 'Exercise the changed paths and the edge conditions they protect.',
    focus: 'Check that tests observe the meaningful consequence of the change, especially failure paths.',
    risk: 'low',
    area: 'Tests',
    rank: 6,
    prompts: ['Does this test prove the user-visible behaviour?', 'Which failure path is still uncovered?', 'Would the old implementation have passed this test?']
  },
  {
    id: 'configuration',
    title: 'Review configuration and deployment impact',
    intent: 'Examine the operational change that can alter how the feature behaves outside local development.',
    focus: 'Check environment compatibility, rollout safety, default values and observability.',
    risk: 'medium',
    area: 'Configuration',
    rank: 7,
    prompts: ['Is this safe across environments?', 'Does rollout order matter?', 'Will an operator notice a failed configuration?']
  },
  {
    id: 'implementation',
    title: 'Review the implementation details',
    intent: 'Inspect the remaining code that implements the requested change.',
    focus: 'Understand how altered control flow, data handling and errors fit into the existing pattern.',
    risk: 'medium',
    area: 'Implementation',
    rank: 8,
    prompts: ['What is the new behaviour here?', 'Which caller is most affected?', 'What happens when this branch fails?']
  }
];

const categoryForPath = (path: string) => {
  const lower = path.toLowerCase();
  if (/migration|schema|database|\/db\//.test(lower)) return categories[0];
  if (/domain|entity|aggregate|valueobject|model/.test(lower)) return categories[1];
  if (/service|usecase|application|workflow|command|handler|job|worker|integration/.test(lower)) return categories[2];
  if (/route|controller|endpoint|api\//.test(lower)) return categories[3];
  if (/component|\.tsx$|\.jsx$|\/app\//.test(lower)) return categories[4];
  if (/test|spec|__tests__/.test(lower)) return categories[5];
  if (/\.ya?ml$|dockerfile|terraform|helm|config|\.env/.test(lower)) return categories[6];
  return categories[7];
};

const titleFromPath = (path: string) => path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? path;

const sectionFor = (category: Category, files: ReviewFileChange[]): SemanticSection => ({
  id: category.id,
  title: category.title,
  intent: category.intent,
  reviewFocus: category.focus,
  risk: category.risk,
  filePaths: files.map((file) => file.path),
  files: files.map((file) => ({
    ...file,
    explanation: `This ${file.kind} change contributes to ${category.area.toLowerCase()}.`
  })),
  relatedSectionIds: [],
  prompts: category.prompts
});

const relateSections = (sections: SemanticSection[]) => sections.map((section, index) => ({
  ...section,
  relatedSectionIds: [sections[index - 1]?.id, sections[index + 1]?.id].filter((id): id is string => Boolean(id))
}));

export function createHeuristicReview(
  title: string,
  changes: ReviewFileChange[],
  description?: string
): SemanticReview {
  const grouped = new Map<string, ReviewFileChange[]>();
  for (const change of changes) {
    const category = categoryForPath(change.path);
    grouped.set(category.id, [...(grouped.get(category.id) ?? []), change]);
  }

  const sections = categories
    .filter((category) => grouped.has(category.id))
    .sort((left, right) => left.rank - right.rank)
    .map((category) => sectionFor(category, grouped.get(category.id) ?? []));
  const areas = [...new Set(sections.map((section) => categories.find((category) => category.id === section.id)?.area ?? 'Implementation'))];
  const firstSentence = description?.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0];

  return {
    overview: {
      purpose: firstSentence || `Review the code changes in “${title}” as a connected software change rather than a flat file list.`,
      scope: `${changes.length} changed ${changes.length === 1 ? 'file' : 'files'} grouped into ${sections.length} meaningful ${sections.length === 1 ? 'concept' : 'concepts'}.`,
      riskSummary: 'Start with the durable behaviour and workflow boundaries before validating the API, interface and tests.',
      areas
    },
    sections: relateSections(sections.length ? sections : [sectionFor(categories[7], changes)])
  };
}

const short = (value: unknown, fallback: string, max: number) => (
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : fallback
);

const safeRisk = (value: unknown): RiskLevel => (
  value === 'high' || value === 'low' || value === 'medium' ? value : 'medium'
);

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(
  value && typeof value === 'object' && !Array.isArray(value)
);

export function normaliseAiReview(
  ai: AiReviewOutline,
  fallback: SemanticReview,
  changes: ReviewFileChange[]
): SemanticReview {
  if (!isRecord(ai) || !Array.isArray(ai.sections) || ai.sections.length === 0) return fallback;

  const byPath = new Map(changes.map((file) => [file.path, file]));
  const usedIds = new Set<string>();
  const usedPaths = new Set<string>();
  const sections: SemanticSection[] = [];

  for (const [index, candidate] of ai.sections.slice(0, 8).entries()) {
    if (!isRecord(candidate)) continue;
    const paths = Array.isArray(candidate.filePaths)
      ? [...new Set(candidate.filePaths.filter((path): path is string => (
        typeof path === 'string' && byPath.has(path) && !usedPaths.has(path)
      )))].slice(0, 24)
      : [];
    if (!paths.length) continue;

    const requestedId = short(candidate.id, `concept-${index + 1}`, 60).replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
    const baseId = requestedId || `concept-${index + 1}`;
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    paths.forEach((path) => usedPaths.add(path));

    const files = paths.map((path) => byPath.get(path)).filter((file): file is ReviewFileChange => Boolean(file));
    sections.push({
      id,
      title: short(candidate.title, `Review ${titleFromPath(paths[0])}`, 100),
      intent: short(candidate.intent, 'Review the related code as one coherent behaviour.', 320),
      reviewFocus: short(candidate.reviewFocus, 'Confirm this code behaves correctly at its boundaries and error paths.', 320),
      risk: safeRisk(candidate.risk),
      filePaths: paths,
      files: files.map((file) => ({ ...file, explanation: 'Included because it contributes to this semantic change.' })),
      relatedSectionIds: Array.isArray(candidate.relatedSectionIds)
        ? candidate.relatedSectionIds.filter((related): related is string => typeof related === 'string').slice(0, 5)
        : [],
      prompts: Array.isArray(candidate.prompts)
        ? candidate.prompts.filter((prompt): prompt is string => typeof prompt === 'string' && Boolean(prompt.trim())).slice(0, 3).map((prompt) => prompt.slice(0, 220))
        : []
    });
  }

  if (!sections.length) return fallback;

  const covered = new Set(sections.flatMap((section) => section.filePaths));
  const uncovered = changes.filter((file) => !covered.has(file.path));
  if (uncovered.length) {
    let remainingId = 'remaining-changes';
    let suffix = 2;
    while (usedIds.has(remainingId)) {
      remainingId = `remaining-changes-${suffix}`;
      suffix += 1;
    }
    sections.push({ ...sectionFor(categories[7], uncovered), id: remainingId });
  }

  const validIds = new Set(sections.map((section) => section.id));
  const overview: Record<string, unknown> = isRecord(ai.overview) ? ai.overview : {};
  return {
    overview: {
      purpose: short(overview.purpose, fallback.overview.purpose, 400),
      scope: short(overview.scope, fallback.overview.scope, 280),
      riskSummary: short(overview.riskSummary, fallback.overview.riskSummary, 360),
      areas: Array.isArray(overview.areas)
        ? overview.areas.filter((area: unknown): area is string => typeof area === 'string' && Boolean(area.trim())).slice(0, 8).map((area: string) => area.slice(0, 60))
        : fallback.overview.areas
    },
    sections: sections.map((section, index) => ({
      ...section,
      prompts: section.prompts.length ? section.prompts : categories[7].prompts,
      relatedSectionIds: section.relatedSectionIds.length
        ? section.relatedSectionIds.filter((id) => validIds.has(id) && id !== section.id)
        : [sections[index - 1]?.id, sections[index + 1]?.id].filter((id): id is string => Boolean(id))
    }))
  };
}
