import { createHash } from "node:crypto";
import type mysql from "mysql2/promise";
import {
  mysteryEventProposalSchema,
  mysteryRunStateSchema,
  type CommittedMysteryEvent,
  type MysteryEventProposal,
  type MysteryRunState,
  type MysteryStoryPackage,
  type StateCondition,
} from "./contracts.js";

export class MysteryInvariantError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "MysteryInvariantError";
  }
}

function unique(values: string[]) {
  return [...new Set(values)];
}

export function createInitialRunState(input: {
  runId: string;
  storyVersionId: string;
  storyPackage: MysteryStoryPackage;
}): MysteryRunState {
  const { runId, storyVersionId, storyPackage } = input;
  const player = storyPackage.entityResourceGraph.actors.find((actor) => actor.kind === "player");
  if (!player) throw new MysteryInvariantError("PLAYER_ACTOR_MISSING", "Story Package 必须包含玩家角色");
  const actors = Object.fromEntries(storyPackage.entityResourceGraph.actors.map((actor) => [actor.actorId, {
    status: actor.initialStatus,
    locationId: actor.initialLocationId,
    physicalState: actor.initialStatus === "dead" ? "死亡" : actor.initialPhysicalState,
    abilities: unique(actor.abilities),
    weaknesses: unique(actor.weaknesses),
  }]));
  const items = Object.fromEntries(storyPackage.entityResourceGraph.items.map((item) => [item.itemInstanceId, {
    ownerId: item.initialOwnerId,
    locationId: item.initialLocationId,
    status: "intact" as const,
  }]));
  const resources = Object.fromEntries(storyPackage.entityResourceGraph.resources.map((resource) => [resource.resourceId, resource.initialAmount]));
  const knowledgeByActor: Record<string, string[]> = {};
  const beliefsByActor: Record<string, string[]> = {};
  for (const actor of storyPackage.entityResourceGraph.actors) {
    knowledgeByActor[actor.actorId] = unique(actor.knownFactIds);
    beliefsByActor[actor.actorId] = unique(actor.mistakenFactIds);
  }
  for (const knowledge of storyPackage.knowledgeGraph.knowledge) {
    for (const actorId of knowledge.holderActorIds) {
      knowledgeByActor[actorId] = unique([...(knowledgeByActor[actorId] ?? []), knowledge.knowledgeId]);
    }
    for (const actorId of knowledge.mistakenHolderActorIds) {
      beliefsByActor[actorId] = unique([...(beliefsByActor[actorId] ?? []), knowledge.knowledgeId]);
    }
  }
  const endings = Object.fromEntries(storyPackage.endingStateGraph.endings.map((ending) => [ending.endingId, {
    status: "eligible" as const,
    reasonEventIds: [],
  }]));
  return mysteryRunStateSchema.parse({
    schemaVersion: 1,
    runId,
    storyVersionId,
    playerActorId: player.actorId,
    worldConstraints: {
      locationIds: storyPackage.entityResourceGraph.locations.map((location) => location.locationId),
      factIds: storyPackage.coreFactGraph.facts.map((fact) => fact.factId),
      knowledgeIds: storyPackage.knowledgeGraph.knowledge.map((knowledge) => knowledge.knowledgeId),
      scheduledEventIds: storyPackage.timelineGraph.scheduledEvents.map((event) => event.scheduledEventId),
      resourceBounds: Object.fromEntries(storyPackage.entityResourceGraph.resources.map((resource) => [resource.resourceId, {
        minimum: resource.minimum,
        maximum: resource.maximum,
      }])),
    },
    worldTimeSeconds: storyPackage.timelineGraph.initialWorldSecond,
    stateVersion: 0,
    turnSequence: 0,
    eventSequence: 0,
    actors,
    items,
    resources,
    knowledgeByActor,
    beliefsByActor,
    triggeredScheduledEventIds: [],
    endings,
    flags: {},
    finalEndingId: null,
  });
}

export function hydrateImmutableActorCapabilities(input: {
  state: unknown;
  storyPackage: MysteryStoryPackage;
}): MysteryRunState {
  const state = mysteryRunStateSchema.parse(input.state);
  const next = structuredClone(state);
  for (const definition of input.storyPackage.entityResourceGraph.actors) {
    const actor = next.actors[definition.actorId];
    if (!actor) continue;
    actor.abilities = unique(definition.abilities);
    actor.weaknesses = unique(definition.weaknesses);
  }
  return mysteryRunStateSchema.parse(next);
}

function valueAtPath(state: MysteryRunState, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current == null || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, state);
}

export function evaluateStateCondition(state: MysteryRunState, condition: StateCondition): boolean {
  if (condition.op === "all") return condition.conditions.every((item) => evaluateStateCondition(state, item));
  if (condition.op === "any") return condition.conditions.some((item) => evaluateStateCondition(state, item));
  if (condition.op === "not") return !evaluateStateCondition(state, condition.condition);
  const current = valueAtPath(state, condition.path);
  switch (condition.op) {
    case "exists": return current !== undefined && current !== null;
    case "eq": return current === condition.value;
    case "neq": return current !== condition.value;
    case "gt": return typeof current === "number" && typeof condition.value === "number" && current > condition.value;
    case "gte": return typeof current === "number" && typeof condition.value === "number" && current >= condition.value;
    case "lt": return typeof current === "number" && typeof condition.value === "number" && current < condition.value;
    case "lte": return typeof current === "number" && typeof condition.value === "number" && current <= condition.value;
    case "includes": return Array.isArray(current) && current.includes(condition.value);
  }
}

export function isScheduledWorldEventDue(
  state: MysteryRunState,
  event: MysteryStoryPackage["timelineGraph"]["scheduledEvents"][number],
) {
  const timeReady = event.triggerAtWorldSecond == null || state.worldTimeSeconds >= event.triggerAtWorldSecond;
  const conditionReady = event.triggerCondition == null || evaluateStateCondition(state, event.triggerCondition);
  return timeReady && conditionReady;
}

export function deterministicRoll(sessionSeed: string, turnSequence: number, transitionId: string, attemptIndex = 0) {
  const digest = createHash("sha256")
    .update(`${sessionSeed}:${turnSequence}:${transitionId}:${attemptIndex}`)
    .digest();
  return digest.readUIntBE(0, 6) / 0x1_0000_0000_0000;
}

export function resolveProbability(input: {
  sessionSeed: string;
  turnSequence: number;
  transitionId: string;
  baseProbability: number;
  factorDeltas: number[];
  attemptIndex?: number;
}) {
  const probability = Math.max(0, Math.min(1, input.baseProbability + input.factorDeltas.reduce((sum, delta) => sum + delta, 0)));
  const roll = deterministicRoll(input.sessionSeed, input.turnSequence, input.transitionId, input.attemptIndex);
  return { probability, roll, succeeded: roll < probability };
}

function cloneState(state: MysteryRunState): MysteryRunState {
  return structuredClone(state);
}

function validateActorCanAct(state: MysteryRunState, proposal: MysteryEventProposal) {
  for (const actorId of proposal.actorIds) {
    if (!state.actors[actorId]) throw new MysteryInvariantError("ACTOR_NOT_FOUND", `行动者 ${actorId} 不存在`);
  }
  for (const perception of proposal.perceivedBy) {
    if (!state.actors[perception.actorId]) throw new MysteryInvariantError("PERCEIVER_NOT_FOUND", `感知者 ${perception.actorId} 不存在`);
  }
  if (!proposal.actorIds.length) return;
  const passiveEventTypes = new Set([
    "UTTERANCE_HEARD", "ACTION_WITNESSED", "WORLD_EVENT_TRIGGERED", "TIME_ADVANCED",
    "ENDING_ACHIEVED", "ENDING_LOCKED", "ENDING_MISSED",
  ]);
  if (passiveEventTypes.has(proposal.eventType)) return;
  for (const actorId of proposal.actorIds) {
    const actor = state.actors[actorId];
    if (actor.status === "dead") throw new MysteryInvariantError("DEAD_ACTOR_ACTION", `死亡人物 ${actorId} 不能产生主动事件`);
    if (actor.status === "incapacitated") throw new MysteryInvariantError("INCAPACITATED_ACTOR_ACTION", `失能人物 ${actorId} 不能产生主动事件`);
  }
  const actorId = proposal.actorIds[0];
  for (const itemId of proposal.requiredItemInstanceIds) {
    const item = state.items[itemId];
    if (!item) throw new MysteryInvariantError("ITEM_NOT_FOUND", `所需物品实例 ${itemId} 不存在`);
    if (item.ownerId !== actorId) throw new MysteryInvariantError("ITEM_NOT_OWNED", `行动者未持有所需物品 ${itemId}`);
    if (["destroyed", "consumed", "lost"].includes(item.status)) throw new MysteryInvariantError("ITEM_UNUSABLE", `所需物品 ${itemId} 当前不可用`);
  }
}

function applyProposalToState(state: MysteryRunState, proposalInput: MysteryEventProposal, eventId: string) {
  const proposal = mysteryEventProposalSchema.parse(proposalInput);
  validateActorCanAct(state, proposal);
  const next = cloneState(state);
  const validLocationIds = new Set(next.worldConstraints.locationIds);
  const validFactualReferenceIds = new Set([...next.worldConstraints.factIds, ...next.worldConstraints.knowledgeIds]);
  const validKnowledgeIds = new Set(next.worldConstraints.knowledgeIds);
  const validScheduledEventIds = new Set(next.worldConstraints.scheduledEventIds);
  if (proposal.locationId && !validLocationIds.has(proposal.locationId)) {
    throw new MysteryInvariantError("LOCATION_NOT_FOUND", `事件地点 ${proposal.locationId} 不存在`);
  }
  for (const scheduledEventId of proposal.scheduledEventTriggers) {
    if (!validScheduledEventIds.has(scheduledEventId)) throw new MysteryInvariantError("SCHEDULED_EVENT_NOT_FOUND", `世界事件 ${scheduledEventId} 不存在`);
  }
  for (const knowledgeId of proposal.expressedKnowledgeIds ?? []) {
    if (!validFactualReferenceIds.has(knowledgeId)) throw new MysteryInvariantError("KNOWLEDGE_NOT_FOUND", `知识或事实 ${knowledgeId} 不存在`);
  }
  if (proposal.timeCostSeconds < 0) throw new MysteryInvariantError("TIME_REVERSED", "世界时间不能回退");
  next.worldTimeSeconds += proposal.timeCostSeconds;

  for (const change of proposal.resourceChanges) {
    if (!(change.resourceId in next.resources)) throw new MysteryInvariantError("RESOURCE_NOT_FOUND", `资源 ${change.resourceId} 不存在`);
    const value = next.resources[change.resourceId] + change.delta;
    const bounds = next.worldConstraints.resourceBounds[change.resourceId];
    if (!bounds) throw new MysteryInvariantError("RESOURCE_BOUNDS_MISSING", `资源 ${change.resourceId} 缺少边界定义`);
    if (!Number.isFinite(value) || value < bounds.minimum) throw new MysteryInvariantError("RESOURCE_UNDERFLOW", `资源 ${change.resourceId} 不足`);
    if (bounds.maximum != null && value > bounds.maximum) throw new MysteryInvariantError("RESOURCE_OVERFLOW", `资源 ${change.resourceId} 超过上限`);
    next.resources[change.resourceId] = value;
  }
  for (const change of proposal.itemChanges) {
    const item = next.items[change.itemInstanceId];
    if (!item) throw new MysteryInvariantError("ITEM_NOT_FOUND", `物品实例 ${change.itemInstanceId} 不存在，不能凭空创建或复制`);
    if (["destroyed", "consumed"].includes(item.status) && change.status !== item.status) {
      throw new MysteryInvariantError("ITEM_IRREVERSIBLE", `物品 ${change.itemInstanceId} 已${item.status === "destroyed" ? "销毁" : "消耗"}`);
    }
    if (change.ownerId !== undefined && change.locationId !== undefined && change.ownerId && change.locationId) {
      throw new MysteryInvariantError("ITEM_DUPLICATED_LOCATION", "物品不能同时被持有并位于场景中");
    }
    if (change.ownerId !== undefined) {
      if (change.ownerId && !next.actors[change.ownerId]) throw new MysteryInvariantError("ITEM_OWNER_NOT_FOUND", `物品所有者 ${change.ownerId} 不存在`);
      item.ownerId = change.ownerId;
      if (change.ownerId) item.locationId = null;
    }
    if (change.locationId !== undefined) {
      if (change.locationId && !validLocationIds.has(change.locationId)) throw new MysteryInvariantError("LOCATION_NOT_FOUND", `物品地点 ${change.locationId} 不存在`);
      item.locationId = change.locationId;
      if (change.locationId) item.ownerId = null;
    }
    if (change.status !== undefined) item.status = change.status;
    if (["destroyed", "consumed"].includes(item.status)) {
      item.ownerId = null;
      item.locationId = null;
    }
  }
  for (const change of proposal.actorChanges) {
    const actor = next.actors[change.actorId];
    if (!actor) throw new MysteryInvariantError("ACTOR_NOT_FOUND", `人物 ${change.actorId} 不存在`);
    if (actor.status === "dead" && change.status && change.status !== "dead") {
      throw new MysteryInvariantError("DEATH_IRREVERSIBLE", `人物 ${change.actorId} 已死亡，不能恢复行动`);
    }
    if (change.status !== undefined) actor.status = change.status;
    if (change.locationId !== undefined) {
      if (change.locationId && !validLocationIds.has(change.locationId)) throw new MysteryInvariantError("LOCATION_NOT_FOUND", `人物地点 ${change.locationId} 不存在`);
      actor.locationId = change.locationId;
    }
    if (change.physicalState !== undefined) actor.physicalState = change.physicalState;
  }
  for (const change of proposal.knowledgeChanges) {
    if (!next.actors[change.actorId]) throw new MysteryInvariantError("ACTOR_NOT_FOUND", `认知主体 ${change.actorId} 不存在`);
    if (!validKnowledgeIds.has(change.knowledgeId)) throw new MysteryInvariantError("KNOWLEDGE_NOT_FOUND", `知识 ${change.knowledgeId} 不存在`);
    const known = next.knowledgeByActor[change.actorId] ?? [];
    const beliefs = next.beliefsByActor[change.actorId] ?? [];
    if (change.operation === "learn") next.knowledgeByActor[change.actorId] = unique([...known, change.knowledgeId]);
    if (change.operation === "believe") next.beliefsByActor[change.actorId] = unique([...beliefs, change.knowledgeId]);
    if (change.operation === "correct_belief") next.beliefsByActor[change.actorId] = beliefs.filter((id) => id !== change.knowledgeId);
  }
  for (const change of proposal.endingChanges) {
    const ending = next.endings[change.endingId];
    if (!ending) throw new MysteryInvariantError("ENDING_NOT_FOUND", `结局 ${change.endingId} 不存在`);
    if (ending.status === "locked" && change.status !== "locked" && !change.authorizationEventId) {
      throw new MysteryInvariantError("ENDING_UNLOCK_UNAUTHORIZED", `已锁定结局 ${change.endingId} 只能由预设解锁事件改变`);
    }
    if (ending.status === "achieved" && change.status !== "achieved") {
      throw new MysteryInvariantError("ENDING_IRREVERSIBLE", `已达成结局 ${change.endingId} 不能恢复`);
    }
    ending.status = change.status;
    ending.reasonEventIds = unique([...ending.reasonEventIds, eventId]);
    if (change.status === "achieved") {
      if (next.finalEndingId && next.finalEndingId !== change.endingId) throw new MysteryInvariantError("MULTIPLE_FINAL_ENDINGS", "一局只能提交一个最终结局");
      next.finalEndingId = change.endingId;
    }
  }
  Object.assign(next.flags, proposal.flagChanges);
  next.triggeredScheduledEventIds = unique([...next.triggeredScheduledEventIds, ...proposal.scheduledEventTriggers]);
  return next;
}

export function projectMysteryProposal(state: MysteryRunState, proposal: MysteryEventProposal) {
  return mysteryRunStateSchema.parse(applyProposalToState(state, proposal, "projection_event"));
}

export function commitEventBatch(input: {
  state: MysteryRunState;
  proposals: MysteryEventProposal[];
  turnId: string;
  idempotencyKey: string;
  eventIds: string[];
}): { state: MysteryRunState; events: CommittedMysteryEvent[] } {
  if (input.proposals.length !== input.eventIds.length) throw new MysteryInvariantError("EVENT_ID_COUNT_MISMATCH", "事件ID数量与提案数量不一致");
  let next = mysteryRunStateSchema.parse(input.state);
  const events: CommittedMysteryEvent[] = [];
  for (let index = 0; index < input.proposals.length; index += 1) {
    const proposal = mysteryEventProposalSchema.parse(input.proposals[index]);
    const before = next.worldTimeSeconds;
    next = applyProposalToState(next, proposal, input.eventIds[index]);
    next.eventSequence += 1;
    next.stateVersion += 1;
    events.push({
      ...proposal,
      eventId: input.eventIds[index],
      runId: next.runId,
      turnId: input.turnId,
      eventIndex: next.eventSequence,
      worldTimeBefore: before,
      worldTimeAfter: next.worldTimeSeconds,
      idempotencyKey: input.idempotencyKey,
      stateVersion: next.stateVersion,
      schemaVersion: 1,
    });
  }
  next.turnSequence += 1;
  return { state: mysteryRunStateSchema.parse(next), events };
}

export function replayMysteryEvents(initialState: MysteryRunState, events: CommittedMysteryEvent[]) {
  let state = mysteryRunStateSchema.parse(initialState);
  let previousTurnId: string | null = null;
  for (const event of [...events].sort((left, right) => left.eventIndex - right.eventIndex)) {
    if (event.runId !== state.runId) throw new MysteryInvariantError("RUN_ISOLATION_VIOLATION", "事件不属于当前 run_id");
    if (event.eventIndex !== state.eventSequence + 1 || event.stateVersion !== state.stateVersion + 1) {
      throw new MysteryInvariantError("EVENT_SEQUENCE_BROKEN", "事件账本序号或状态版本不连续");
    }
    state = applyProposalToState(state, event, event.eventId);
    state.eventSequence = event.eventIndex;
    state.stateVersion = event.stateVersion;
    if (event.turnId !== previousTurnId) state.turnSequence += 1;
    previousTurnId = event.turnId;
  }
  return mysteryRunStateSchema.parse(state);
}

export async function appendMysteryTurnAtomically(input: {
  connection: mysql.PoolConnection;
  runId: string;
  expectedStateVersion: number;
  turnId: string;
  idempotencyKey: string;
  processingToken: string;
  rawInput: string;
  resolutionJson: unknown;
  narrative: string;
  state: MysteryRunState;
  events: CommittedMysteryEvent[];
}) {
  const { connection } = input;
  const [runUpdate] = await connection.query<mysql.ResultSetHeader>(
    `UPDATE mystery_runs
     SET state_snapshot = ?, current_world_time_seconds = ?, state_version = ?, turn_sequence = ?,
       event_sequence = ?, status = ?, final_ending_id = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND state_version = ? AND status = 'active'`,
    [JSON.stringify(input.state), input.state.worldTimeSeconds, input.state.stateVersion, input.state.turnSequence,
      input.state.eventSequence, input.state.finalEndingId ? "completed" : "active", input.state.finalEndingId,
      input.runId, input.expectedStateVersion],
  );
  if (runUpdate.affectedRows !== 1) throw new MysteryInvariantError("STATE_VERSION_CONFLICT", "世界状态已变化，请刷新后重试");
  const [turnUpdate] = await connection.query<mysql.ResultSetHeader>(
    `UPDATE mystery_turns
     SET turn_sequence = ?, status = 'completed', state_version_after = ?, resolution_json = ?,
       narrative = ?, processing_token = NULL, processing_expires_at = NULL, completed_at = CURRENT_TIMESTAMP
     WHERE id = ? AND run_id = ? AND idempotency_key = ? AND status = 'processing' AND processing_token = ?`,
    [input.state.turnSequence, input.state.stateVersion, JSON.stringify(input.resolutionJson), input.narrative,
      input.turnId, input.runId, input.idempotencyKey, input.processingToken],
  );
  if (turnUpdate.affectedRows !== 1) throw new MysteryInvariantError("TURN_STATE_CONFLICT", "回合状态已变化，不能重复提交");
  for (const event of input.events) {
    await connection.query(
      `INSERT INTO mystery_world_events
        (id, run_id, turn_id, event_index, event_type, world_time_before, world_time_after,
         actor_ids, target_ids, location_id, event_payload, irreversible, is_key_node,
         key_node_type, idempotency_key, committed_state_version, schema_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [event.eventId, event.runId, event.turnId, event.eventIndex, event.eventType,
        event.worldTimeBefore, event.worldTimeAfter, JSON.stringify(event.actorIds), JSON.stringify(event.targetIds),
        event.locationId, JSON.stringify(event), event.irreversible ? 1 : 0, event.keyNode ? 1 : 0,
        event.keyNodeType, event.idempotencyKey, event.stateVersion, event.schemaVersion],
    );
  }
  await connection.query(
    `INSERT INTO mystery_state_snapshots (id, run_id, state_version, event_index, state_snapshot)
     VALUES (?, ?, ?, ?, ?)`,
    [`snapshot_${input.turnId}`, input.runId, input.state.stateVersion, input.state.eventSequence, JSON.stringify(input.state)],
  );
}
