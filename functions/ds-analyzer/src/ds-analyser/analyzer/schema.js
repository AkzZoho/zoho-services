/**
 * @deprecated
 * Zod schema for the LLM-generated analysis result.
 * Used only by `analyzer/index.js` (the two-step pipeline, currently
 * unused by the UI). Keep until `routes/analyze.js` is formally removed.
 */
const { z } = require('zod');

const ChangeType = z.enum([
  'ADD_FIELD',
  'MODIFY_FIELD',
  'REMOVE_FIELD',
  'ADD_FORM',
  'MODIFY_FORM',
  'ADD_REPORT',
  'MODIFY_REPORT',
  'ADD_WORKFLOW',
  'MODIFY_WORKFLOW',
  'ADD_PAGE',
  'MODIFY_PAGE',
  'ADD_ROLE',
  'OTHER',
]);

const Change = z.object({
  id: z.string(),
  type: ChangeType,
  target: z.object({
    entity: z.enum(['form', 'report', 'workflow', 'page', 'role', 'app']),
    name: z.string(),
  }),
  pmSummary: z.string(),
  devDetails: z.object({
    what: z.string(),
    how: z.string(),
    delugeSnippet: z.string().nullable().optional(),
    affectedEntities: z.array(z.string()).default([]),
    validations: z.array(z.string()).default([]),
  }),
  impact: z.object({
    breaking: z.boolean().default(false),
    affectsData: z.boolean().default(false),
    affectsUsers: z.array(z.string()).default([]),
  }),
  requirementSource: z.string().default(''),
  confidence: z.number().min(0).max(1).default(0.5),
});

const AnalysisResult = z.object({
  summary: z.object({
    pmHeadline: z.string(),
    estimatedEffort: z.enum(['S', 'M', 'L', 'XL']).default('M'),
    risk: z.enum(['low', 'medium', 'high']).default('medium'),
    confidence: z.number().min(0).max(1).default(0.5),
  }),
  changes: z.array(Change).default([]),
  openQuestions: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});

module.exports = { AnalysisResult, Change, ChangeType };
