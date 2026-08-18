import { z } from "zod";

export const mysteryIdSchema = z.string().trim().min(1).max(96).regex(/^[A-Za-z0-9:_-]+$/);
const shortText = z.string().trim().min(1).max(500);
const longText = z.string().trim().min(1).max(200_000);
const idList = z.array(mysteryIdSchema).max(500).default([]);

export const mysteryStorySourceSchema = z.object({
  title: z.string().trim().min(1).max(120),
  coverUrl: z.string().trim().max(2_000).nullable().default(null),
  tags: z.array(z.string().trim().min(1).max(24)).max(12).default([]),
  storyBackground: longText,
  storyContent: longText,
  characterDesign: longText,
  presetEndings: longText,
  coreSettings: longText,
  display: z.object({
    hook: z.string().trim().max(300).default(""),
    genres: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
    era: z.string().trim().max(120).default(""),
    region: z.string().trim().max(120).default(""),
    perspective: z.string().trim().max(120).default(""),
    targetDurationMinutes: z.number().int().min(5).max(2_400).default(90),
    playMode: z.enum(["single", "multiplayer_room"]).default("multiplayer_room"),
    contentRating: z.string().trim().max(80).default(""),
    themes: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
    allowedContent: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
    forbiddenContent: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  }).default({}),
  playerRole: z.object({
    actorId: mysteryIdSchema.default("PLAYER_1"),
    identity: shortText,
    physicalProfile: z.string().trim().max(2_000).default(""),
    socialStatus: z.string().trim().max(500).default(""),
    skills: z.array(shortText).max(50).default([]),
    excludedAbilities: z.array(shortText).max(50).default([]),
    initialLocationId: mysteryIdSchema,
    initialGoals: z.array(shortText).min(1).max(20),
    initialKnowledgeIds: idList,
    initialItemInstanceIds: idList,
    initialResources: z.record(z.number().finite().min(0)).default({}),
    initialPhysicalState: z.string().trim().max(1_000).default("正常"),
    publicIdentity: z.string().trim().max(1_000).default(""),
    hiddenIdentity: z.string().trim().max(2_000).default(""),
    mayLie: z.boolean().default(true),
    mayTakeHighRiskActions: z.boolean().default(true),
  }),
  worldRules: z.object({
    worldType: z.enum(["realistic", "fantasy", "mixed"]),
    technologyLevel: z.string().trim().max(500).default(""),
    supernaturalRules: z.array(shortText).max(100).default([]),
    lawsAndNorms: z.array(shortText).max(100).default([]),
    lifeAndDeathRules: z.array(shortText).max(100).default([]),
    medicalRules: z.array(shortText).max(100).default([]),
    communicationRules: z.array(shortText).max(100).default([]),
    transportRules: z.array(shortText).max(100).default([]),
    informationSpeedRules: z.array(shortText).max(100).default([]),
    allowsResurrection: z.boolean().default(false),
    allowsTimeTravel: z.boolean().default(false),
    allowsPrecognition: z.boolean().default(false),
    allowsMindReading: z.boolean().default(false),
    absoluteImpossibilities: z.array(shortText).max(100).default([]),
  }),
  authoringNotes: z.record(z.unknown()).default({}),
});

export type MysteryStorySource = z.infer<typeof mysteryStorySourceSchema>;

export const atomicFactSchema = z.object({
  factId: mysteryIdSchema,
  factKind: z.enum([
    "world_rule", "past_event", "identity", "location", "possession", "resource",
    "objective_fact", "belief", "rumor", "misunderstanding", "plan", "secret",
    "clue", "trigger", "ending_condition", "prohibition",
  ]),
  statement: shortText,
  subjectId: mysteryIdSchema.nullable().default(null),
  predicate: z.string().trim().min(1).max(120),
  objectId: mysteryIdSchema.nullable().default(null),
  timeScope: z.record(z.string().max(120)).default({}),
  locationId: mysteryIdSchema.nullable().default(null),
  truthStatus: z.enum(["true", "false", "undetermined"]),
  mutability: z.enum(["immutable", "session_initialized", "deferred", "runtime_mutable", "forbidden"]),
  commitStatus: z.enum(["committed", "uncommitted"]),
  knowledgeHolderIds: idList,
  playerVisibility: z.enum(["visible", "hidden", "discoverable"]),
  revealConditionIds: idList,
  dependencyFactIds: idList,
  conflictFactIds: idList,
  persistence: z.enum(["permanent", "run"]),
});

export const actorDefinitionSchema = z.object({
  actorId: mysteryIdSchema,
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["player", "npc"]),
  publicBackground: z.string().trim().max(5_000).default(""),
  hiddenBackground: z.string().trim().max(10_000).default(""),
  outwardTraits: z.array(shortText).max(30).default([]),
  goals: z.array(shortText).max(30).default([]),
  currentPlan: z.string().trim().max(5_000).default(""),
  abilities: z.array(shortText).max(50).default([]),
  weaknesses: z.array(shortText).max(50).default([]),
  prohibitions: z.array(shortText).max(50).default([]),
  moralLimits: z.array(shortText).max(50).default([]),
  initialLocationId: mysteryIdSchema,
  scheduleIds: idList,
  knownFactIds: idList,
  unknownFactIds: idList,
  mistakenFactIds: idList,
  secretIds: idList,
  responseRules: z.array(shortText).max(100).default([]),
  speechStyle: z.string().trim().max(2_000).default(""),
  initialStatus: z.enum(["active", "incapacitated", "missing", "dead"]).default("active"),
  initialPhysicalState: z.string().trim().max(5_000).default("正常"),
});

export const locationDefinitionSchema = z.object({
  locationId: mysteryIdSchema,
  name: z.string().trim().min(1).max(120),
  regionId: mysteryIdSchema.nullable().default(null),
  connections: z.array(z.object({
    toLocationId: mysteryIdSchema,
    travelSeconds: z.number().int().min(0).max(31_536_000),
    entryConditionIds: idList,
  })).max(100).default([]),
  visibility: z.string().trim().max(1_000).default(""),
  audibility: z.string().trim().max(1_000).default(""),
  environment: z.string().trim().max(5_000).default(""),
  initialActorIds: idList,
  initialItemInstanceIds: idList,
  interactiveObjectIds: idList,
  hiddenAreaIds: idList,
  searchDifficulty: z.enum(["trivial", "ordinary", "trained", "expert", "impossible"]).default("ordinary"),
  traceRules: z.array(shortText).max(100).default([]),
  timedChangeIds: idList,
});

export const itemDefinitionSchema = z.object({
  itemInstanceId: mysteryIdSchema,
  itemTypeId: mysteryIdSchema,
  name: z.string().trim().min(1).max(120),
  unique: z.boolean().default(true),
  initialLocationId: mysteryIdSchema.nullable().default(null),
  initialOwnerId: mysteryIdSchema.nullable().default(null),
  consumable: z.boolean().default(false),
  useConditionIds: idList,
  useEffectIds: idList,
  damageable: z.boolean().default(false),
  transferable: z.boolean().default(true),
  hideable: z.boolean().default(true),
  copyable: z.boolean().default(false),
  evidence: z.boolean().default(false),
  recognizedByActorIds: idList,
  destructionConsequenceIds: idList,
});

export const resourceDefinitionSchema = z.object({
  resourceId: mysteryIdSchema,
  name: z.string().trim().min(1).max(120),
  ownerId: mysteryIdSchema,
  initialAmount: z.number().finite().min(0),
  minimum: z.number().finite().default(0),
  maximum: z.number().finite().nullable().default(null),
  unit: z.string().trim().max(40).default(""),
});

export const knowledgeDefinitionSchema = z.object({
  knowledgeId: mysteryIdSchema,
  kind: z.enum(["truth", "secret", "clue", "rumor", "lie", "misunderstanding", "inference"]),
  objectiveStatement: shortText,
  holderActorIds: idList,
  mistakenHolderActorIds: idList,
  hiddenByActorIds: idList,
  evidenceItemIds: idList,
  evidenceLocationIds: idList,
  acquireConditionIds: idList,
  canBeDestroyed: z.boolean().default(false),
  affectedActorIds: idList,
  irreversibleOnceRevealed: z.boolean().default(true),
  relatedEndingIds: idList,
  propagationRules: z.array(shortText).max(100).default([]),
});

export const stateConditionSchema: z.ZodType<StateCondition> = z.lazy(() => z.union([
  z.object({ op: z.literal("all"), conditions: z.array(stateConditionSchema).min(1).max(100) }),
  z.object({ op: z.literal("any"), conditions: z.array(stateConditionSchema).min(1).max(100) }),
  z.object({ op: z.literal("not"), condition: stateConditionSchema }),
  z.object({
    op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "includes", "exists"]),
    path: z.string().trim().min(1).max(300).regex(/^[A-Za-z0-9_.:-]+$/),
    value: z.unknown().optional(),
  }),
]));

export type StateCondition =
  | { op: "all"; conditions: StateCondition[] }
  | { op: "any"; conditions: StateCondition[] }
  | { op: "not"; condition: StateCondition }
  | { op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "includes" | "exists"; path: string; value?: unknown };

export const actionTransitionSchema = z.object({
  transitionId: mysteryIdSchema,
  actionKind: z.string().trim().min(1).max(80),
  description: shortText,
  precondition: stateConditionSchema,
  deterministic: z.boolean(),
  baseSuccessProbability: z.number().min(0).max(1).nullable().default(null),
  probabilityFactors: z.array(z.object({ condition: stateConditionSchema, delta: z.number().min(-1).max(1), reason: shortText })).max(30).default([]),
  successEffectIds: idList,
  failureEffectIds: idList,
  timeCostSeconds: z.number().int().min(0).max(31_536_000),
  audibleToLocationIds: idList,
  visibleToLocationIds: idList,
  irreversible: z.boolean().default(false),
});

export const actionEffectSchema = z.object({
  effectId: mysteryIdSchema,
  description: shortText,
  resourceChanges: z.array(z.object({ resourceId: mysteryIdSchema, delta: z.number().finite(), reason: shortText })).max(100).default([]),
  itemChanges: z.array(z.object({
    itemInstanceId: mysteryIdSchema,
    ownerId: mysteryIdSchema.nullable().optional(),
    locationId: mysteryIdSchema.nullable().optional(),
    status: z.enum(["intact", "damaged", "destroyed", "consumed", "lost"]).optional(),
    reason: shortText,
  })).max(100).default([]),
  actorChanges: z.array(z.object({
    actorId: mysteryIdSchema,
    status: z.enum(["active", "incapacitated", "missing", "dead"]).optional(),
    locationId: mysteryIdSchema.nullable().optional(),
    physicalState: z.string().trim().max(5_000).optional(),
    reason: shortText,
  })).max(100).default([]),
  knowledgeChanges: z.array(z.object({ actorId: mysteryIdSchema, knowledgeId: mysteryIdSchema, operation: z.enum(["learn", "believe", "correct_belief"]), reason: shortText })).max(200).default([]),
  flagChanges: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
});

export const scheduledWorldEventSchema = z.object({
  scheduledEventId: mysteryIdSchema,
  name: z.string().trim().min(1).max(160),
  triggerAtWorldSecond: z.number().int().min(0).nullable().default(null),
  triggerCondition: stateConditionSchema.nullable().default(null),
  effectIds: idList,
  canBeMissed: z.boolean().default(false),
  keyNode: z.boolean().default(false),
  playerVisible: z.boolean().optional(),
  playerVisibleSummary: z.string().trim().min(1).max(500).optional(),
  visibleToLocationIds: idList,
  audibleToLocationIds: idList,
});

export const endingDefinitionSchema = z.object({
  endingId: mysteryIdSchema,
  name: z.string().trim().min(1).max(160),
  family: z.enum(["main", "drift", "observer", "failure", "death", "timeout", "exit"]),
  priority: z.number().int().min(0).max(10_000),
  requiredCondition: stateConditionSchema,
  blockingCondition: stateConditionSchema.nullable().default(null),
  lockEventIds: idList,
  unlockEventIds: idList,
  invalidateEventIds: idList,
  epilogueDimensions: z.array(shortText).max(50).default([]),
});

export const mysteryStoryPackageSchema = z.object({
  schemaVersion: z.literal(1),
  storyId: mysteryIdSchema,
  versionNumber: z.number().int().positive(),
  summary: z.string().trim().min(1).max(5_000),
  coreFactGraph: z.object({ facts: z.array(atomicFactSchema).min(1).max(5_000) }),
  entityResourceGraph: z.object({
    actors: z.array(actorDefinitionSchema).min(1).max(500),
    locations: z.array(locationDefinitionSchema).min(1).max(1_000),
    items: z.array(itemDefinitionSchema).max(5_000).default([]),
    resources: z.array(resourceDefinitionSchema).max(2_000).default([]),
    organizations: z.array(z.object({ organizationId: mysteryIdSchema, name: shortText, memberActorIds: idList })).max(500).default([]),
  }),
  knowledgeGraph: z.object({ knowledge: z.array(knowledgeDefinitionSchema).max(5_000).default([]) }),
  actionTransitionGraph: z.object({
    adjudicationMode: z.enum(["deterministic", "reproducible_random", "hybrid"]),
    transitions: z.array(actionTransitionSchema).max(5_000).default([]),
    effects: z.array(actionEffectSchema).max(5_000).default([]),
  }),
  timelineGraph: z.object({
    initialWorldSecond: z.number().int().min(0),
    scheduledEvents: z.array(scheduledWorldEventSchema).max(5_000).default([]),
  }),
  endingStateGraph: z.object({
    endings: z.array(endingDefinitionSchema).min(1).max(100),
    fallbackEndingIds: idList,
  }),
  narrativeStyle: z.object({
    voice: z.string().trim().min(1).max(2_000),
    tense: z.string().trim().max(120).default(""),
    prohibitedTechniques: z.array(shortText).max(100).default([]),
  }),
});

export type MysteryStoryPackage = z.infer<typeof mysteryStoryPackageSchema>;

export const actorRuntimeStateSchema = z.object({
  status: z.enum(["active", "incapacitated", "missing", "dead"]),
  locationId: mysteryIdSchema.nullable(),
  physicalState: z.string().trim().max(5_000),
  abilities: z.array(shortText).max(50).default([]),
  weaknesses: z.array(shortText).max(50).default([]),
});

export const itemRuntimeStateSchema = z.object({
  ownerId: mysteryIdSchema.nullable(),
  locationId: mysteryIdSchema.nullable(),
  status: z.enum(["intact", "damaged", "destroyed", "consumed", "lost"]),
});

export const endingRuntimeStateSchema = z.object({
  status: z.enum(["eligible", "weakened", "locked", "missed", "achieved"]),
  reasonEventIds: idList,
});

export const mysteryRunStateSchema = z.object({
  schemaVersion: z.literal(1),
  runId: mysteryIdSchema,
  storyVersionId: mysteryIdSchema,
  playerActorId: mysteryIdSchema,
  worldConstraints: z.object({
    locationIds: idList,
    factIds: idList,
    knowledgeIds: idList,
    scheduledEventIds: idList,
    resourceBounds: z.record(z.object({
      minimum: z.number().finite().min(0),
      maximum: z.number().finite().min(0).nullable(),
    })),
  }),
  worldTimeSeconds: z.number().int().min(0),
  stateVersion: z.number().int().min(0),
  turnSequence: z.number().int().min(0),
  eventSequence: z.number().int().min(0),
  actors: z.record(actorRuntimeStateSchema),
  items: z.record(itemRuntimeStateSchema),
  resources: z.record(z.number().finite().min(0)),
  knowledgeByActor: z.record(z.array(mysteryIdSchema).max(10_000)),
  beliefsByActor: z.record(z.array(mysteryIdSchema).max(10_000)),
  triggeredScheduledEventIds: idList,
  endings: z.record(endingRuntimeStateSchema),
  flags: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  finalEndingId: mysteryIdSchema.nullable(),
});

export type MysteryRunState = z.infer<typeof mysteryRunStateSchema>;

export const resourceChangeSchema = z.object({
  resourceId: mysteryIdSchema,
  delta: z.number().finite(),
  reason: shortText,
});

export const itemChangeSchema = z.object({
  itemInstanceId: mysteryIdSchema,
  ownerId: mysteryIdSchema.nullable().optional(),
  locationId: mysteryIdSchema.nullable().optional(),
  status: itemRuntimeStateSchema.shape.status.optional(),
  reason: shortText,
});

export const actorChangeSchema = z.object({
  actorId: mysteryIdSchema,
  status: actorRuntimeStateSchema.shape.status.optional(),
  locationId: mysteryIdSchema.nullable().optional(),
  physicalState: z.string().trim().max(5_000).optional(),
  reason: shortText,
});

export const knowledgeChangeSchema = z.object({
  actorId: mysteryIdSchema,
  knowledgeId: mysteryIdSchema,
  operation: z.enum(["learn", "believe", "correct_belief"]),
  reason: shortText,
});

export const endingChangeSchema = z.object({
  endingId: mysteryIdSchema,
  status: endingRuntimeStateSchema.shape.status,
  reason: shortText,
  authorizationEventId: mysteryIdSchema.nullable().default(null),
});

export const mysteryEventProposalSchema = z.object({
  transitionId: mysteryIdSchema.nullable().optional(),
  appliedEffectIds: z.array(mysteryIdSchema).max(100).optional(),
  eventType: z.string().trim().min(1).max(80).regex(/^[A-Z][A-Z0-9_]*$/),
  actorIds: idList,
  targetIds: idList,
  locationId: mysteryIdSchema.nullable().default(null),
  rawUtterance: z.string().max(10_000).nullable().default(null),
  normalizedMeaning: z.string().trim().max(5_000).nullable().default(null),
  expressedKnowledgeIds: z.array(mysteryIdSchema).max(100).optional(),
  perceivedBy: z.array(z.object({
    actorId: mysteryIdSchema,
    perception: z.enum(["heard_complete", "heard_partial", "heard_incorrectly", "saw_complete", "saw_partial"]),
  })).max(500).default([]),
  causedByEventIds: idList,
  requiredItemInstanceIds: idList,
  scheduledEventTriggers: idList,
  timeCostSeconds: z.number().int().min(0).max(31_536_000).default(0),
  resourceChanges: z.array(resourceChangeSchema).max(500).default([]),
  itemChanges: z.array(itemChangeSchema).max(500).default([]),
  actorChanges: z.array(actorChangeSchema).max(500).default([]),
  knowledgeChanges: z.array(knowledgeChangeSchema).max(1_000).default([]),
  endingChanges: z.array(endingChangeSchema).max(100).default([]),
  flagChanges: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  irreversible: z.boolean().default(false),
  keyNode: z.boolean().default(false),
  keyNodeType: z.string().trim().max(80).nullable().default(null),
  visibleToPlayer: z.boolean().optional(),
  playerVisibleSummary: z.string().trim().min(1).max(10_000),
});

export type MysteryEventProposal = z.infer<typeof mysteryEventProposalSchema>;

export const mysteryTurnResolutionSchema = z.object({
  inputClassification: z.enum(["utterance", "move", "observe", "search", "use_item", "attack", "interact", "wait", "think", "state_query", "meta_instruction"]),
  injectionRisk: z.enum(["none", "suspicious", "blocked"]),
  normalizedIntents: z.array(z.object({
    sequence: z.number().int().positive(),
    kind: z.string().trim().min(1).max(80),
    actorId: mysteryIdSchema,
    targetIds: idList,
    description: shortText,
    executionStatus: z.enum(["considered", "deferred_after_uncertainty", "rejected"]),
  })).min(1).max(20),
  ignoredResultClaims: z.array(shortText).max(20).default([]),
  adjudication: z.array(z.object({
    intentSequence: z.number().int().positive(),
    outcome: z.enum(["impossible", "blocked", "failure", "failure_with_cost", "partial_success", "success_with_cost", "success"]),
    reason: shortText,
    probabilityBasis: z.string().trim().max(2_000).nullable().default(null),
  })).max(20),
  totalTimeCostSeconds: z.number().int().min(0).max(31_536_000),
  proposedEvents: z.array(mysteryEventProposalSchema).min(1).max(200),
  playerVisibleResults: z.array(shortText).min(1).max(100),
  scheduledWorldEvents: z.array(scheduledWorldEventSchema).max(100).default([]),
  endingSignals: z.array(z.object({ endingId: mysteryIdSchema, signal: z.enum(["strengthened", "weakened", "lock_candidate", "achieve_candidate"]), reason: shortText })).max(100).default([]),
  consistencyWarnings: z.array(shortText).max(100).default([]),
});

export type MysteryTurnResolution = z.infer<typeof mysteryTurnResolutionSchema>;

export const playerVisiblePacketSchema = z.object({
  storyTitle: z.string().trim().min(1).max(120),
  worldTimeSeconds: z.number().int().min(0),
  approvedEvents: z.array(z.object({ eventType: z.string().trim().min(1).max(80), summary: shortText })).max(200),
  perceivableEnvironment: z.array(shortText).max(100),
  knownInformation: z.array(shortText).max(200),
  allowedNpcExpressions: z.array(z.object({
    actorId: mysteryIdSchema,
    actorName: z.string().trim().min(1).max(120).default("故事人物"),
    text: shortText,
  })).max(100),
  playerObjective: shortText.nullable().default(null),
  actionAffordances: z.array(shortText).max(12).default([]),
  playerState: z.object({
    locationName: z.string().trim().max(120).nullable(),
    physicalState: z.string().trim().max(5_000),
    carriedItems: z.array(z.object({ name: shortText, status: z.enum(["intact", "damaged", "destroyed", "consumed", "lost"]) })).max(500),
    resources: z.array(z.object({ name: shortText, amount: z.number().finite().min(0), unit: z.string().trim().max(40) })).max(200),
  }),
  narrativeStyle: mysteryStoryPackageSchema.shape.narrativeStyle,
  offMainlineReminder: z.string().trim().max(500).nullable().default(null),
  gameEnded: z.boolean(),
  endingName: z.string().trim().max(160).nullable().default(null),
});

export type PlayerVisiblePacket = z.infer<typeof playerVisiblePacketSchema>;

export type CommittedMysteryEvent = MysteryEventProposal & {
  eventId: string;
  runId: string;
  turnId: string;
  eventIndex: number;
  worldTimeBefore: number;
  worldTimeAfter: number;
  idempotencyKey: string;
  stateVersion: number;
  schemaVersion: 1;
};
