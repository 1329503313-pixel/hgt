import { z } from "zod";
import type { AtomicFact, ProgressKeyFact } from "./gameLogic.js";

const progressKeyFactSchema = z.object({
  id: z.number().int().nonnegative(),
  content: z.string(),
  weight: z.number().nonnegative(),
}).strict();

const atomicFactSchema = z.object({
  id: z.number().int().nonnegative(),
  keyId: z.number().int().nonnegative(),
  content: z.string(),
  weight: z.number().nonnegative(),
}).strict();

const snapshotSchema = z.object({
  soupId: z.string().min(1),
  title: z.string(),
  type: z.string(),
  surface: z.string(),
  bottom: z.string(),
  manual: z.string(),
  supplementalSurfaces: z.array(z.string()),
  supplementalBottoms: z.array(z.string()),
  keyFacts: z.array(progressKeyFactSchema).min(1),
  atomicFacts: z.array(atomicFactSchema).min(1),
  contentHash: z.string().min(1),
}).strict();

export type AiSoupRoundSnapshot = {
  soupId: string;
  title: string;
  type: string;
  surface: string;
  bottom: string;
  manual: string;
  supplementalSurfaces: string[];
  supplementalBottoms: string[];
  keyFacts: ProgressKeyFact[];
  atomicFacts: AtomicFact[];
  contentHash: string;
};

export function parseAiSoupRoundSnapshot(value: unknown): AiSoupRoundSnapshot | null {
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); }
    catch { return null; }
  }
  const result = snapshotSchema.safeParse(parsed);
  return result.success ? result.data : null;
}
