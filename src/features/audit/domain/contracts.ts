import { z } from "zod";

const edgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  kind: z.string(),
});

const backlinkSchema = z.object({
  id: z.string(),
  kind: z.string().optional(),
}).passthrough();

export const graphNodeSchema = z.object({
  id: z.string(),
  claim: z.string().default(""),
  scope: z.array(z.string()).default([]),
  confidence: z.number().default(0),
  status: z.string().default("active"),
  reinforcement_count: z.number().default(0),
  supersedes: z.array(z.string()).default([]),
  related: z.array(z.string()).default([]),
  conflicts_with: z.array(z.string()).default([]),
  evidence_log: z.array(z.unknown()).default([]),
  query_local: z.string().optional().default(""),
  updated_at: z.string().optional(),
  referenced_by: z.array(backlinkSchema).optional().default([]),
}).passthrough();

export const graphDataSchema = z.object({
  generated_at: z.string().default(""),
  nodes: z.array(graphNodeSchema).default([]),
  edges: z.array(edgeSchema).default([]),
});

export const unifiedNodeSchema = z.object({
  id: z.string(),
  kind: z.string(),
  label: z.string().optional(),
  path: z.string().optional(),
  heading: z.string().optional(),
  claim: z.string().optional(),
  scope: z.array(z.string()).optional(),
  confidence: z.number().optional(),
  status: z.string().optional(),
  reinforcement_count: z.number().optional(),
  supersedes: z.array(z.string()).optional(),
  related: z.array(z.string()).optional(),
  conflicts_with: z.array(z.string()).optional(),
  evidence_log: z.array(z.unknown()).optional(),
  query_local: z.string().optional(),
  updated_at: z.string().optional(),
  referenced_by: z.array(backlinkSchema).optional(),
}).passthrough();

export const unifiedGraphSchema = z.object({
  generated_at: z.string().default(""),
  nodes: z.array(unifiedNodeSchema).default([]),
  edges: z.array(edgeSchema).default([]),
});

const linkedRuleSchema = z.object({
  id: z.string(),
  claim: z.string().optional(),
}).passthrough();

export const docHitSchema = z.object({
  id: z.string(),
  path: z.string(),
  heading: z.string().optional().default(""),
  score: z.number().default(0),
  snippet: z.string().optional().default(""),
  line_start: z.number().optional(),
  line_end: z.number().optional(),
}).passthrough();

export const docSearchSchema = z.object({
  hits: z.array(docHitSchema).default([]),
}).passthrough();

export const docChunkSchema = z.object({
  id: z.string().optional(),
  path: z.string(),
  heading: z.string().optional().default(""),
  line_start: z.number().optional(),
  line_end: z.number().optional(),
  referenced_rules: z.array(linkedRuleSchema).optional().default([]),
  cited_rules: z.array(linkedRuleSchema).optional().default([]),
}).passthrough();

export const docFileSchema = z.object({
  path: z.string(),
  content: z.string().default(""),
}).passthrough();

export const healthSchema = z.object({
  ok: z.boolean().optional().default(true),
  vault: z.string().optional().default(""),
  shelves: z.object({
    enabled: z.boolean().optional().default(false),
    indexed: z.boolean().optional().default(false),
    chunk_count: z.number().optional().default(0),
  }).passthrough().optional().default({ enabled: false, indexed: false, chunk_count: 0 }),
}).passthrough();

export type GraphNode = z.infer<typeof graphNodeSchema> & {
  _kind?: string;
  path?: string;
  heading?: string;
};
export type GraphEdge = z.infer<typeof edgeSchema>;
export type GraphData = z.infer<typeof graphDataSchema>;
export type UnifiedGraph = z.infer<typeof unifiedGraphSchema>;
export type DocHit = z.infer<typeof docHitSchema>;
export type DocChunk = z.infer<typeof docChunkSchema>;
export type DocFile = z.infer<typeof docFileSchema>;
export type DeskHealth = z.infer<typeof healthSchema>;

export function parseContract<T>(schema: z.ZodType<T>, value: unknown): T {
  return schema.parse(value);
}
