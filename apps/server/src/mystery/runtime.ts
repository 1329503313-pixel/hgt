import { createHash, randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import { nanoid } from "nanoid";
import { pool } from "../db.js";
import {
  mysteryRunStateSchema,
  mysteryStoryPackageSchema,
  mysteryTurnResolutionSchema,
  playerVisiblePacketSchema,
  type MysteryEventProposal,
  type MysteryRunState,
  type MysteryStoryPackage,
  type MysteryTurnResolution,
  type PlayerVisiblePacket,
} from "./contracts.js";
import {
  appendMysteryTurnAtomically,
  commitEventBatch,
  createInitialRunState,
  hydrateImmutableActorCapabilities,
  evaluateStateCondition,
  isScheduledWorldEventDue,
  MysteryInvariantError,
  projectMysteryProposal,
  resolveProbability,
} from "./engine.js";
import { adjudicateMysteryTurn, MysteryModelError, renderMysteryNarrative, reviewMysteryNarrativeConsistency, type MysteryResolutionRuntimeIssue } from "./models.js";
import { validateMysteryStoryPackageIntegrity } from "./packageValidation.js";

function jsonValue<T>(value: unknown): T {
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
}

export const MYSTERY_TURN_LEASE_SECONDS = 120;
const MYSTERY_TURN_HEARTBEAT_MS = 30_000;
const MYSTERY_TURN_CANCELLATION_POLL_MS = 750;

export function mysteryTurnLeaseCanBeClaimed(input: {
  status: string;
  processingExpiresAt: string | number | Date | null;
  now?: string | number | Date;
}) {
  if (["received", "failed"].includes(input.status)) return true;
  if (input.status !== "processing") return false;
  if (!input.processingExpiresAt) return true;
  const expiresAt = new Date(input.processingExpiresAt).getTime();
  const now = input.now === undefined ? Date.now() : new Date(input.now).getTime();
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}

export function mysteryTurnConflictAction(code: string): "defer" | "retry" | "cancel" | "fail" {
  if (code === "TURN_ALREADY_PROCESSING") return "defer";
  if (["TURN_STATE_CONFLICT", "STATE_VERSION_CONFLICT"].includes(code)) return "retry";
  if (code === "TURN_CANCELLED") return "cancel";
  return "fail";
}

export function isMysteryTurnCancellation(error: unknown, signalAborted = false) {
  if (signalAborted) return true;
  if (error instanceof MysteryInvariantError) return error.code === "TURN_CANCELLED";
  return error instanceof MysteryModelError && error.code === "MODEL_REQUEST_CANCELLED";
}

export type MysteryRunChoice = "continue" | "restart";

export function mysteryRunBindingAction(input: {
  boundRoomId: string | null;
  boundRoomStatus: string | null;
  nextRoomId: string;
}): "none" | "detach_previous" {
  if (!input.boundRoomId || input.boundRoomId === input.nextRoomId) return "none";
  if (input.boundRoomStatus === "playing") {
    throw new MysteryInvariantError("MYSTERY_RUN_IN_USE", "这个谜局存档正在另一个房间中进行，请先结束原房间");
  }
  return "detach_previous";
}

export async function startOrContinueMysteryRun(input: {
  storyId: string;
  ownerUserId: string;
  choice: MysteryRunChoice;
  roomId: string;
  connection?: mysql.PoolConnection;
}) {
  const ownConnection = !input.connection;
  const connection = input.connection ?? await pool.getConnection();
  try {
    if (ownConnection) await connection.beginTransaction();
    const [[story]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT id, title, story_background, published_version_id
       FROM mystery_stories
       WHERE id = ? AND publication_status = 'published' AND published_version_id IS NOT NULL
       LIMIT 1 FOR UPDATE`,
      [input.storyId],
    );
    if (!story) throw new MysteryInvariantError("MYSTERY_NOT_PUBLISHED", "谜局不存在或尚未上架");
    const [[slot]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT slot.current_run_id, runs.status, runs.state_version, runs.room_id,
         runs.story_title_snapshot, runs.story_background_snapshot,
         bound_room.status AS bound_room_status
       FROM mystery_save_slots slot
       JOIN mystery_runs runs ON runs.id = slot.current_run_id
       LEFT JOIN online_soup_rooms bound_room ON bound_room.id = runs.room_id
       WHERE slot.owner_user_id = ? AND slot.story_id = ? LIMIT 1 FOR UPDATE`,
      [input.ownerUserId, input.storyId],
    );
    const bindingAction = slot ? mysteryRunBindingAction({
      boundRoomId: slot.room_id ? String(slot.room_id) : null,
      boundRoomStatus: slot.bound_room_status ? String(slot.bound_room_status) : null,
      nextRoomId: input.roomId,
    }) : "none";
    if (bindingAction === "detach_previous") {
      await connection.query(
        `UPDATE online_soup_rooms
         SET content_type = 'soup', current_mystery_id = NULL, current_mystery_run_id = NULL,
           status = IF(status = 'ended', 'preparing', status), last_action_at = CURRENT_TIMESTAMP
         WHERE id = ? AND current_mystery_run_id = ? AND status <> 'playing'`,
        [slot.room_id, slot.current_run_id],
      );
    }
    if (input.choice === "continue" && slot && String(slot.status) === "active") {
      await connection.query(
        "UPDATE mystery_runs SET room_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner_user_id = ?",
        [input.roomId, slot.current_run_id, input.ownerUserId],
      );
      if (ownConnection) await connection.commit();
      return {
        runId: String(slot.current_run_id), continued: true,
        title: slot.story_title_snapshot ? String(slot.story_title_snapshot) : String(story.title),
        background: slot.story_background_snapshot ? String(slot.story_background_snapshot) : String(story.story_background),
      };
    }
    if (slot && String(slot.status) === "active") {
      await connection.query(
        "UPDATE mystery_runs SET status = 'superseded', completed_at = CURRENT_TIMESTAMP WHERE id = ? AND owner_user_id = ? AND status = 'active'",
        [slot.current_run_id, input.ownerUserId],
      );
    }
    const [[version]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT id, source_snapshot, compiled_package FROM mystery_story_versions
       WHERE id = ? AND story_id = ? AND review_status = 'approved' LIMIT 1`,
      [story.published_version_id, input.storyId],
    );
    if (!version) throw new MysteryInvariantError("PUBLISHED_VERSION_MISSING", "谜局发布版本不可用");
    const storyPackage = mysteryStoryPackageSchema.parse(jsonValue(version.compiled_package));
    const packageIssues = validateMysteryStoryPackageIntegrity(storyPackage);
    if (packageIssues.length) throw new MysteryInvariantError("STORY_PACKAGE_INVALID", `谜局发布版本不完整：${packageIssues[0]}`);
    const sourceSnapshot = version.source_snapshot ? jsonValue<{ title: string; storyBackground: string }>(version.source_snapshot) : null;
    const runTitle = sourceSnapshot?.title ?? String(story.title);
    const runBackground = sourceSnapshot?.storyBackground ?? String(story.story_background);
    const runId = `run_${nanoid()}`;
    const sessionSeed = createHash("sha256").update(randomBytes(32)).update(runId).digest("hex");
    const state = createInitialRunState({ runId, storyVersionId: String(version.id), storyPackage });
    const initializationTurnId = `turn_${nanoid()}`;
    const initializationIdempotencyKey = `${runId}:system-initialization`;
    const initializationProcessingToken = `turn_lease_${nanoid()}`;
    const initialization = commitScheduledEventCascade({
      storyPackage,
      state,
      turnId: initializationTurnId,
      idempotencyKey: initializationIdempotencyKey,
    });
    await connection.query(
      `INSERT INTO mystery_runs
        (id, story_id, story_version_id, owner_user_id, room_id, session_seed, story_title_snapshot,
         story_background_snapshot, current_world_time_seconds, state_snapshot)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [runId, input.storyId, version.id, input.ownerUserId, input.roomId ?? null, sessionSeed,
        runTitle, runBackground, state.worldTimeSeconds, JSON.stringify(state)],
    );
    await connection.query(
      `INSERT INTO mystery_save_slots (owner_user_id, story_id, current_run_id)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE current_run_id = VALUES(current_run_id), updated_at = CURRENT_TIMESTAMP`,
      [input.ownerUserId, input.storyId, runId],
    );
    await connection.query(
      `INSERT INTO mystery_state_snapshots (id, run_id, state_version, event_index, state_snapshot)
       VALUES (?, ?, 0, 0, ?)`,
      [`snapshot_${runId}_initial`, runId, JSON.stringify(state)],
    );
    if (initialization.events.length) {
      await connection.query(
        `INSERT INTO mystery_turns
          (id, run_id, turn_sequence, idempotency_key, raw_input, input_classification, injection_risk,
           status, attempt_count, processing_token, processing_expires_at, state_version_before)
         VALUES (?, ?, NULL, ?, ?, 'state_query', 'none', 'processing', 1, ?,
           DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND), 0)`,
        [initializationTurnId, runId, initializationIdempotencyKey, "__SYSTEM_INITIALIZATION__",
          initializationProcessingToken, MYSTERY_TURN_LEASE_SECONDS],
      );
      await appendMysteryTurnAtomically({
        connection,
        runId,
        expectedStateVersion: 0,
        turnId: initializationTurnId,
        idempotencyKey: initializationIdempotencyKey,
        processingToken: initializationProcessingToken,
        rawInput: "__SYSTEM_INITIALIZATION__",
        resolutionJson: { kind: "system_initialization" },
        narrative: "",
        state: initialization.state,
        events: initialization.events,
      });
    }
    if (ownConnection) await connection.commit();
    return { runId, continued: false, title: runTitle, background: runBackground };
  } catch (error) {
    if (ownConnection) await connection.rollback().catch(() => {});
    throw error;
  } finally {
    if (ownConnection) connection.release();
  }
}

function effectProposal(storyPackage: MysteryStoryPackage, effectIds: string[], input: {
  eventType: string;
  summary: string;
  scheduledEventId?: string;
  keyNode?: boolean;
  visibleToPlayer?: boolean;
}): MysteryEventProposal {
  const effects = effectIds.map((effectId) => storyPackage.actionTransitionGraph.effects.find((effect) => effect.effectId === effectId));
  if (effects.some((effect) => !effect)) throw new MysteryInvariantError("EFFECT_NOT_FOUND", "Story Package 引用了不存在的世界效果");
  const causesDeath = effects.some((effect) => effect!.actorChanges.some((change) => change.status === "dead"));
  const destroysItem = effects.some((effect) => effect!.itemChanges.some((change) => change.status === "destroyed" || change.status === "consumed"));
  const isKeyNode = input.keyNode || causesDeath || destroysItem;
  return {
    eventType: input.eventType,
    actorIds: [],
    targetIds: [],
    locationId: null,
    rawUtterance: null,
    normalizedMeaning: input.summary,
    perceivedBy: [],
    causedByEventIds: [],
    requiredItemInstanceIds: [],
    scheduledEventTriggers: input.scheduledEventId ? [input.scheduledEventId] : [],
    timeCostSeconds: 0,
    resourceChanges: effects.flatMap((effect) => effect!.resourceChanges),
    itemChanges: effects.flatMap((effect) => effect!.itemChanges),
    actorChanges: effects.flatMap((effect) => effect!.actorChanges),
    knowledgeChanges: effects.flatMap((effect) => effect!.knowledgeChanges),
    endingChanges: [],
    flagChanges: Object.assign({}, ...effects.map((effect) => effect!.flagChanges)),
    irreversible: true,
    keyNode: isKeyNode,
    keyNodeType: causesDeath ? "death" : destroysItem ? "item_irreversible" : input.keyNode ? "world_event" : null,
    visibleToPlayer: input.visibleToPlayer ?? false,
    playerVisibleSummary: input.summary,
  };
}

function scheduledEventProposals(storyPackage: MysteryStoryPackage, state: MysteryRunState) {
  const playerLocationId = state.actors[state.playerActorId]?.locationId ?? null;
  return storyPackage.timelineGraph.scheduledEvents
    .filter((event) => !state.triggeredScheduledEventIds.includes(event.scheduledEventId))
    .filter((event) => isScheduledWorldEventDue(state, event))
    .sort((left, right) => (left.triggerAtWorldSecond ?? Number.MAX_SAFE_INTEGER) - (right.triggerAtWorldSecond ?? Number.MAX_SAFE_INTEGER))
    .map((event) => {
      const perceptionLocations = [...event.visibleToLocationIds, ...event.audibleToLocationIds];
      const playerCanPerceive = event.playerVisible === true
        && (perceptionLocations.length === 0 || Boolean(playerLocationId && perceptionLocations.includes(playerLocationId)));
      return effectProposal(storyPackage, event.effectIds, {
        eventType: "WORLD_EVENT_TRIGGERED",
        scheduledEventId: event.scheduledEventId,
        keyNode: event.keyNode,
        visibleToPlayer: playerCanPerceive,
        summary: event.playerVisibleSummary ?? `${event.name}发生了。`,
      });
    });
}

function commitScheduledEventCascade(input: {
  storyPackage: MysteryStoryPackage;
  state: MysteryRunState;
  turnId: string;
  idempotencyKey: string;
}) {
  let state = input.state;
  const proposals: MysteryEventProposal[] = [];
  const events: ReturnType<typeof commitEventBatch>["events"] = [];
  for (let pass = 0; pass <= input.storyPackage.timelineGraph.scheduledEvents.length; pass += 1) {
    const next = scheduledEventProposals(input.storyPackage, state);
    if (!next.length) return { state, proposals, events };
    const committed = commitEventBatch({
      state,
      proposals: next,
      turnId: input.turnId,
      idempotencyKey: input.idempotencyKey,
      eventIds: next.map(() => `event_${nanoid()}`),
    });
    state = committed.state;
    proposals.push(...next);
    events.push(...committed.events);
  }
  throw new MysteryInvariantError("WORLD_EVENT_CASCADE_OVERFLOW", "世界事件触发链超过 Story Package 安全上限");
}

const OPEN_WORLD_EVENT_TYPES = new Set([
  "META_INSTRUCTION_REJECTED",
  "UTTERANCE_OCCURRED",
  "ACTION_DECLARED",
  "ACTION_ATTEMPTED",
  "ACTION_SUCCEEDED",
  "ACTION_FAILED",
  "ACTION_BLOCKED",
  "MOVE_COMPLETED",
  "OBSERVATION_COMPLETED",
  "SEARCH_COMPLETED",
  "INTERACTION_COMPLETED",
  "ITEM_PICKED_UP",
  "ITEM_DROPPED",
  "ITEM_TRANSFERRED",
  "RESOURCE_CHANGED",
  "WAIT_COMPLETED",
]);

const UNCONFIRMED_PROTECTED_EVENT_TYPE = /(DEAD|DIED|DEATH|ENDING|SECRET|REVEAL|DESTROY|CONSUME|INCAPACITAT|INJUR|HARM)/i;

function requireStoryTransition(message: string): never {
  throw new MysteryInvariantError("TRANSITION_REQUIRED", message);
}

function canonicalizeOpenWorldProposal(input: {
  storyPackage: MysteryStoryPackage;
  state: MysteryRunState;
  proposal: MysteryEventProposal;
  baseVisibility: boolean;
  playerActs: boolean;
  playerLocationId: string | null;
}): MysteryEventProposal {
  const { storyPackage, state, proposal } = input;
  const locationDefinitions = new Map(storyPackage.entityResourceGraph.locations.map((location) => [location.locationId, location]));
  const itemDefinitions = new Map(storyPackage.entityResourceGraph.items.map((item) => [item.itemInstanceId, item]));
  const resourceDefinitions = new Map(storyPackage.entityResourceGraph.resources.map((resource) => [resource.resourceId, resource]));
  const knowledgeDefinitions = new Map(storyPackage.knowledgeGraph.knowledge.map((knowledge) => [knowledge.knowledgeId, knowledge]));
  const primaryActorId = proposal.actorIds[0] ?? null;
  const primaryActor = primaryActorId ? state.actors[primaryActorId] : null;
  const primaryLocationId = primaryActor?.locationId ?? proposal.locationId;
  const involvedActorIds = new Set([...proposal.actorIds, ...proposal.targetIds.filter((id) => Boolean(state.actors[id]))]);

  if (proposal.appliedEffectIds?.length) {
    throw new MysteryInvariantError("EFFECT_REQUIRES_TRANSITION", "通用行动不能直接引用 Story Package 效果；如需预设效果请填写对应 transitionId");
  }
  if (proposal.endingChanges.length) requireStoryTransition("结局变化只能由结局状态图或 Story Package 行动转换推动");
  if (Object.keys(proposal.flagChanges).length) requireStoryTransition("主线世界标记变化必须引用 Story Package 中的行动转换");
  if (proposal.scheduledEventTriggers.length) {
    throw new MysteryInvariantError("SCHEDULED_EVENT_MANAGED_BY_SERVER", "排期世界事件由服务端世界时钟触发，通用行动不能直接触发");
  }

  const requireLocalActor = (actorId: string) => {
    const actor = state.actors[actorId];
    if (!actor) throw new MysteryInvariantError("ACTOR_NOT_FOUND", `人物 ${actorId} 不存在`);
    if (!primaryLocationId || actor.locationId !== primaryLocationId) {
      throw new MysteryInvariantError("ACTOR_OUT_OF_REACH", `人物 ${actorId} 不在行动者当前可交互范围内`);
    }
    return actor;
  };

  let minimumTimeCostSeconds = proposal.rawUtterance ? 1 : 0;
  const actorChanges = proposal.actorChanges.map((change) => {
    const actor = state.actors[change.actorId];
    if (!actor) throw new MysteryInvariantError("ACTOR_NOT_FOUND", `人物 ${change.actorId} 不存在`);
    if (!involvedActorIds.has(change.actorId)) {
      throw new MysteryInvariantError("ACTOR_CHANGE_UNRELATED", `人物 ${change.actorId} 未参与本回合，不能被通用行动改变`);
    }
    if (change.actorId !== primaryActorId) requireLocalActor(change.actorId);
    if (change.status === "dead" || change.status === "missing") {
      requireStoryTransition(`人物 ${change.actorId} 的死亡或失踪属于受保护变化，必须引用 Story Package 行动转换`);
    }
    if (change.locationId !== undefined) {
      if (!change.locationId) requireStoryTransition("人物离开世界地图属于受保护变化，必须引用 Story Package 行动转换");
      if (!proposal.actorIds.includes(change.actorId)) {
        throw new MysteryInvariantError("ACTOR_MOVE_UNAUTHORIZED", `人物 ${change.actorId} 没有作为本回合行动者，不能被直接移动`);
      }
      const fromLocation = actor.locationId ? locationDefinitions.get(actor.locationId) : null;
      const connection = fromLocation?.connections.find((entry) => entry.toLocationId === change.locationId);
      if (!connection) {
        throw new MysteryInvariantError("LOCATION_NOT_REACHABLE", `人物 ${change.actorId} 无法从当前位置直接到达 ${change.locationId}`);
      }
      if (connection.entryConditionIds.length) {
        requireStoryTransition(`前往 ${change.locationId} 需要满足预设进入条件，必须使用 Story Package 行动转换裁决`);
      }
      minimumTimeCostSeconds = Math.max(minimumTimeCostSeconds, connection.travelSeconds);
    }
    if (change.status !== undefined || change.physicalState !== undefined) minimumTimeCostSeconds = Math.max(minimumTimeCostSeconds, 5);
    return change;
  });

  const actorCanReachItem = (itemId: string) => {
    const item = state.items[itemId];
    if (!item) throw new MysteryInvariantError("ITEM_NOT_FOUND", `物品实例 ${itemId} 不存在，不能凭空创建或复制`);
    if (["destroyed", "consumed", "lost"].includes(item.status)) {
      throw new MysteryInvariantError("ITEM_UNUSABLE", `物品 ${itemId} 当前不可操作`);
    }
    const owner = item.ownerId ? state.actors[item.ownerId] : null;
    const accessible = Boolean(
      (item.ownerId && involvedActorIds.has(item.ownerId) && owner?.locationId === primaryLocationId)
      || (item.ownerId && item.ownerId === primaryActorId)
      || (item.locationId && item.locationId === primaryLocationId),
    );
    if (!accessible) throw new MysteryInvariantError("ITEM_OUT_OF_REACH", `物品 ${itemId} 不在行动者当前可见、可操作范围内`);
    return item;
  };

  const itemChanges = proposal.itemChanges.map((change) => {
    const item = actorCanReachItem(change.itemInstanceId);
    const definition = itemDefinitions.get(change.itemInstanceId);
    if (!definition) throw new MysteryInvariantError("ITEM_NOT_FOUND", `物品定义 ${change.itemInstanceId} 不存在`);
    let ownerId = change.ownerId;
    let locationId = change.locationId;
    if (ownerId !== undefined && ownerId !== item.ownerId) {
      if (item.ownerId && !definition.transferable) {
        requireStoryTransition(`物品 ${change.itemInstanceId} 不允许普通转移`);
      }
      if (ownerId) {
        requireLocalActor(ownerId);
        locationId = null;
      } else if (locationId === undefined) {
        if (!primaryLocationId) throw new MysteryInvariantError("LOCATION_REQUIRED", `放下物品 ${change.itemInstanceId} 时缺少当前地点`);
        locationId = primaryLocationId;
      }
    }
    if (locationId !== undefined && locationId !== item.locationId) {
      const clearsLocationForOwnershipOrRemoval = locationId === null && Boolean(
        ownerId || change.status === "destroyed" || change.status === "consumed",
      );
      if (!clearsLocationForOwnershipOrRemoval && locationId !== primaryLocationId) {
        throw new MysteryInvariantError("ITEM_TELEPORT_FORBIDDEN", `物品 ${change.itemInstanceId} 不能被通用行动移动到行动者不可达地点`);
      }
      if (!clearsLocationForOwnershipOrRemoval) ownerId = null;
    }
    if (change.status === "damaged" && !definition.damageable) {
      requireStoryTransition(`物品 ${change.itemInstanceId} 没有可损坏设定`);
    }
    if (change.status === "destroyed") {
      if (!definition.damageable || definition.destructionConsequenceIds.length) {
        requireStoryTransition(`物品 ${change.itemInstanceId} 的销毁具有预设约束或后果，必须使用 Story Package 行动转换`);
      }
      ownerId = null;
      locationId = null;
    }
    if (change.status === "consumed") {
      if (!definition.consumable || definition.useEffectIds.length) {
        requireStoryTransition(`物品 ${change.itemInstanceId} 的使用或消耗具有预设效果，必须使用 Story Package 行动转换`);
      }
      ownerId = null;
      locationId = null;
    }
    if (change.status === "lost") requireStoryTransition(`物品 ${change.itemInstanceId} 的遗失必须使用 Story Package 行动转换`);
    minimumTimeCostSeconds = Math.max(minimumTimeCostSeconds, 2);
    return { ...change, ownerId, locationId };
  });

  const resourceChanges = proposal.resourceChanges.map((change) => {
    const definition = resourceDefinitions.get(change.resourceId);
    if (!definition) throw new MysteryInvariantError("RESOURCE_NOT_FOUND", `资源 ${change.resourceId} 不存在`);
    if (!involvedActorIds.has(definition.ownerId)) {
      throw new MysteryInvariantError("RESOURCE_CHANGE_UNRELATED", `资源 ${change.resourceId} 的持有者未参与本回合`);
    }
    if (definition.ownerId !== primaryActorId) requireLocalActor(definition.ownerId);
    minimumTimeCostSeconds = Math.max(minimumTimeCostSeconds, 1);
    return change;
  });
  const positiveResourceGroups = new Map<string, number>();
  for (const change of resourceChanges) {
    if (change.delta <= 0) continue;
    const definition = resourceDefinitions.get(change.resourceId)!;
    positiveResourceGroups.set(`${definition.name}\u0000${definition.unit}`, 0);
  }
  for (const key of positiveResourceGroups.keys()) {
    const netDelta = resourceChanges.reduce((sum, change) => {
      const definition = resourceDefinitions.get(change.resourceId)!;
      return `${definition.name}\u0000${definition.unit}` === key ? sum + change.delta : sum;
    }, 0);
    if (netDelta > 0) requireStoryTransition("通用行动不能凭空增加资源；资源增加必须有同类资源来源或使用 Story Package 行动转换");
  }

  const communicationSpeakerId = proposal.rawUtterance ? primaryActorId : null;
  const speakerReferences = communicationSpeakerId
    ? new Set([...(state.knowledgeByActor[communicationSpeakerId] ?? []), ...(state.beliefsByActor[communicationSpeakerId] ?? [])])
    : new Set<string>();
  const knowledgeChanges = proposal.knowledgeChanges.map((change) => {
    const actor = state.actors[change.actorId];
    const definition = knowledgeDefinitions.get(change.knowledgeId);
    if (!actor) throw new MysteryInvariantError("ACTOR_NOT_FOUND", `认知主体 ${change.actorId} 不存在`);
    if (!definition) throw new MysteryInvariantError("KNOWLEDGE_NOT_FOUND", `知识 ${change.knowledgeId} 不存在`);
    if (!involvedActorIds.has(change.actorId)) {
      throw new MysteryInvariantError("KNOWLEDGE_TARGET_UNRELATED", `人物 ${change.actorId} 未参与本回合，不能获得新认知`);
    }
    if (change.actorId !== primaryActorId) requireLocalActor(change.actorId);
    if (definition.acquireConditionIds.length) {
      requireStoryTransition(`知识 ${change.knowledgeId} 存在预设获取条件，必须使用 Story Package 行动转换`);
    }
    const evidenceAtLocation = Boolean(actor.locationId && definition.evidenceLocationIds.includes(actor.locationId));
    const evidenceInReach = definition.evidenceItemIds.some((itemId) => {
      const item = state.items[itemId];
      return Boolean(item && (item.ownerId === change.actorId || (item.locationId && item.locationId === actor.locationId)));
    });
    const heardFromHolder = Boolean(
      communicationSpeakerId
      && communicationSpeakerId !== change.actorId
      && speakerReferences.has(change.knowledgeId)
      && state.actors[communicationSpeakerId]?.locationId === actor.locationId
      && (proposal.perceivedBy.some((entry) => entry.actorId === change.actorId && entry.perception.startsWith("heard_"))
        || involvedActorIds.has(change.actorId)),
    );
    const alreadyKnown = (state.knowledgeByActor[change.actorId] ?? []).includes(change.knowledgeId);
    const alreadyBelieved = (state.beliefsByActor[change.actorId] ?? []).includes(change.knowledgeId);
    const grounded = evidenceAtLocation || evidenceInReach || heardFromHolder;
    if (change.operation === "learn" && !alreadyKnown && !grounded) {
      throw new MysteryInvariantError("KNOWLEDGE_BASIS_REQUIRED", `人物 ${change.actorId} 获知 ${change.knowledgeId} 时缺少可见证据或知情者传达`);
    }
    if (change.operation === "believe" && !alreadyBelieved && !grounded) {
      throw new MysteryInvariantError("BELIEF_BASIS_REQUIRED", `人物 ${change.actorId} 形成 ${change.knowledgeId} 的认知时缺少感知依据`);
    }
    if (change.operation === "correct_belief" && (!alreadyBelieved || !grounded)) {
      throw new MysteryInvariantError("BELIEF_CORRECTION_BASIS_REQUIRED", `人物 ${change.actorId} 修正 ${change.knowledgeId} 时缺少原认知或纠正依据`);
    }
    minimumTimeCostSeconds = Math.max(minimumTimeCostSeconds, 2);
    return change;
  });

  const hasMaterialChanges = resourceChanges.length > 0 || itemChanges.length > 0
    || actorChanges.length > 0 || knowledgeChanges.length > 0;
  const unconfirmedProtectedClaim = proposal.eventType !== "META_INSTRUCTION_REJECTED" && !hasMaterialChanges && (
    proposal.keyNode || proposal.irreversible || UNCONFIRMED_PROTECTED_EVENT_TYPE.test(proposal.eventType)
  );
  const safeEventType = proposal.eventType === "META_INSTRUCTION_REJECTED"
    ? proposal.eventType
    : proposal.rawUtterance && !hasMaterialChanges
      ? "UTTERANCE_OCCURRED"
      : hasMaterialChanges
        ? OPEN_WORLD_EVENT_TYPES.has(proposal.eventType) ? proposal.eventType : "ACTION_SUCCEEDED"
        : OPEN_WORLD_EVENT_TYPES.has(proposal.eventType)
          ? proposal.eventType
          : proposal.timeCostSeconds > 0 ? "ACTION_ATTEMPTED" : "ACTION_DECLARED";
  const genericSummary = proposal.timeCostSeconds > 0
    ? "你完成了这项行动，但没有产生新的已确认变化。"
    : "这个意图没有改变当前世界状态。";
  const destroysItem = itemChanges.some((change) => change.status === "destroyed" || change.status === "consumed");
  const discoversSecret = knowledgeChanges.some((change) => {
    const definition = knowledgeDefinitions.get(change.knowledgeId);
    return change.operation === "learn" && definition?.kind === "secret";
  });

  return {
    ...proposal,
    appliedEffectIds: [],
    eventType: safeEventType,
    locationId: input.playerActs ? input.playerLocationId : proposal.locationId,
    normalizedMeaning: proposal.normalizedMeaning,
    timeCostSeconds: Math.max(proposal.timeCostSeconds, minimumTimeCostSeconds),
    resourceChanges,
    itemChanges,
    actorChanges,
    knowledgeChanges,
    endingChanges: [],
    flagChanges: {},
    irreversible: destroysItem || knowledgeChanges.some((change) => {
      const definition = knowledgeDefinitions.get(change.knowledgeId);
      return change.operation === "learn" && definition?.irreversibleOnceRevealed === true;
    }),
    keyNode: destroysItem || discoversSecret,
    keyNodeType: destroysItem ? "item_irreversible" : discoversSecret ? "secret_discovered" : null,
    visibleToPlayer: input.baseVisibility,
    playerVisibleSummary: unconfirmedProtectedClaim ? genericSummary : proposal.playerVisibleSummary,
  };
}

function canonicalizeAgentProposal(input: {
  storyPackage: MysteryStoryPackage;
  state: MysteryRunState;
  sessionSeed: string;
  proposal: MysteryEventProposal;
}): MysteryEventProposal {
  const { storyPackage, state, sessionSeed } = input;
  const proposal = input.proposal;
  const locationIds = new Set(storyPackage.entityResourceGraph.locations.map((location) => location.locationId));
  const knowledgeIds = new Set(storyPackage.knowledgeGraph.knowledge.map((knowledge) => knowledge.knowledgeId));
  const factualReferenceIds = new Set([...knowledgeIds, ...storyPackage.coreFactGraph.facts.map((fact) => fact.factId)]);
  const effectById = new Map(storyPackage.actionTransitionGraph.effects.map((effect) => [effect.effectId, effect]));
  const transitionById = new Map(storyPackage.actionTransitionGraph.transitions.map((transition) => [transition.transitionId, transition]));
  const playerLocationId = state.actors[state.playerActorId]?.locationId ?? null;
  const playerActs = proposal.actorIds.includes(state.playerActorId);
  const playerPerceives = proposal.perceivedBy.some((perception) => perception.actorId === state.playerActorId);
  const sameLocation = Boolean(playerLocationId && proposal.locationId === playerLocationId);
  const baseVisibility = playerActs || Boolean(proposal.visibleToPlayer && (playerPerceives || sameLocation));

    for (const change of proposal.actorChanges) {
      if (change.locationId && !locationIds.has(change.locationId)) throw new MysteryInvariantError("LOCATION_NOT_FOUND", `地点 ${change.locationId} 不存在`);
    }
    for (const change of proposal.itemChanges) {
      if (change.locationId && !locationIds.has(change.locationId)) throw new MysteryInvariantError("LOCATION_NOT_FOUND", `地点 ${change.locationId} 不存在`);
    }
    for (const change of proposal.knowledgeChanges) {
      if (!knowledgeIds.has(change.knowledgeId)) throw new MysteryInvariantError("KNOWLEDGE_NOT_FOUND", `知识 ${change.knowledgeId} 不存在`);
    }
    const speakerId = proposal.actorIds[0];
    const speaker = storyPackage.entityResourceGraph.actors.find((actor) => actor.actorId === speakerId);
    if (proposal.rawUtterance && speaker?.kind === "npc") {
      const allowedKnowledge = new Set([...(state.knowledgeByActor[speakerId] ?? []), ...(state.beliefsByActor[speakerId] ?? [])]);
      for (const knowledgeId of proposal.expressedKnowledgeIds ?? []) {
        if (!factualReferenceIds.has(knowledgeId) || !allowedKnowledge.has(knowledgeId)) {
          throw new MysteryInvariantError("NPC_KNOWLEDGE_LEAK", `NPC ${speakerId} 试图表达其未知的信息`);
        }
      }
    }
    if (!proposal.transitionId) {
      return canonicalizeOpenWorldProposal({ storyPackage, state, proposal, baseVisibility, playerActs, playerLocationId });
    }
    const transition = transitionById.get(proposal.transitionId);
    if (!transition) throw new MysteryInvariantError("TRANSITION_NOT_FOUND", `行动转换 ${proposal.transitionId} 不存在`);
    if (!evaluateStateCondition(state, transition.precondition)) {
      return {
        ...proposal,
        eventType: "ACTION_BLOCKED",
        appliedEffectIds: [],
        timeCostSeconds: 0,
        resourceChanges: [], itemChanges: [], actorChanges: [], knowledgeChanges: [], endingChanges: [], flagChanges: {},
        irreversible: false,
        visibleToPlayer: true,
        playerVisibleSummary: "当前条件不足，这个行动没有实际执行。",
      };
    }
    let succeeded = true;
    if (!transition.deterministic) {
      if (transition.baseSuccessProbability == null) throw new MysteryInvariantError("PROBABILITY_MISSING", `行动转换 ${transition.transitionId} 缺少基础概率`);
      const factorDeltas = transition.probabilityFactors
        .filter((factor) => evaluateStateCondition(state, factor.condition))
        .map((factor) => factor.delta);
      succeeded = resolveProbability({
        sessionSeed,
        turnSequence: state.turnSequence + 1,
        transitionId: transition.transitionId,
        baseProbability: transition.baseSuccessProbability,
        factorDeltas,
      }).succeeded;
    }
    const allowedEffectIds = succeeded ? transition.successEffectIds : transition.failureEffectIds;
    if ((proposal.appliedEffectIds ?? []).some((effectId) => !allowedEffectIds.includes(effectId))) {
      throw new MysteryInvariantError("EFFECT_NOT_ALLOWED", "裁决提案引用了当前结果不允许的效果");
    }
    const effects = allowedEffectIds.map((effectId) => effectById.get(effectId));
    if (effects.some((effect) => !effect)) throw new MysteryInvariantError("EFFECT_NOT_FOUND", `行动转换 ${transition.transitionId} 引用了不存在的效果`);
    const causesDeath = effects.some((effect) => effect!.actorChanges.some((change) => change.status === "dead"));
    const destroysItem = effects.some((effect) => effect!.itemChanges.some((change) => change.status === "destroyed" || change.status === "consumed"));
    const discoversSecret = effects.some((effect) => effect!.knowledgeChanges.some((change) => {
      const knowledge = storyPackage.knowledgeGraph.knowledge.find((entry) => entry.knowledgeId === change.knowledgeId);
      return knowledge?.kind === "secret";
    }));
    const transitionPerceivable = Boolean(playerLocationId && (
      transition.visibleToLocationIds.includes(playerLocationId) || transition.audibleToLocationIds.includes(playerLocationId)
    ));
    const cleanClause = (value: string) => value.trim().replace(/[；;。]+$/g, "");
    const effectSummary = effects.map((effect) => cleanClause(effect!.description)).filter(Boolean).join("；");
    const approvedSummary = succeeded
      ? [cleanClause(transition.description), effectSummary].filter(Boolean).join("；")
      : effectSummary
        ? `尝试${transition.description}没有成功；${effectSummary}`
        : `尝试${transition.description}，但没有成功。`;
    return {
      ...proposal,
      eventType: succeeded ? "ACTION_SUCCEEDED" : "ACTION_FAILED",
      appliedEffectIds: allowedEffectIds,
      timeCostSeconds: transition.timeCostSeconds,
      resourceChanges: effects.flatMap((effect) => effect!.resourceChanges),
      itemChanges: effects.flatMap((effect) => effect!.itemChanges),
      actorChanges: effects.flatMap((effect) => effect!.actorChanges),
      knowledgeChanges: effects.flatMap((effect) => effect!.knowledgeChanges),
      endingChanges: [],
      flagChanges: Object.assign({}, ...effects.map((effect) => effect!.flagChanges)),
      irreversible: transition.irreversible || effects.some((effect) => effect!.itemChanges.some((change) => change.status === "destroyed" || change.status === "consumed") || effect!.actorChanges.some((change) => change.status === "dead")),
      keyNode: proposal.keyNode || causesDeath || destroysItem || discoversSecret,
      keyNodeType: causesDeath ? "death" : destroysItem ? "item_irreversible" : discoversSecret ? "secret_discovered" : proposal.keyNodeType,
      visibleToPlayer: playerActs || Boolean(proposal.visibleToPlayer && (playerPerceives || sameLocation || transitionPerceivable)),
      playerVisibleSummary: approvedSummary,
    };
}

export function canonicalizeAgentProposals(input: {
  storyPackage: MysteryStoryPackage;
  state: MysteryRunState;
  sessionSeed: string;
  proposals: MysteryEventProposal[];
}) {
  const output: MysteryEventProposal[] = [];
  let projectedState = input.state;
  for (const proposal of input.proposals) {
    const canonical = canonicalizeAgentProposal({
      storyPackage: input.storyPackage,
      state: projectedState,
      sessionSeed: input.sessionSeed,
      proposal,
    });
    output.push(canonical);
    projectedState = projectMysteryProposal(projectedState, canonical);
  }
  return output;
}

export function validateMysteryResolutionForRuntime(input: {
  storyPackage: MysteryStoryPackage;
  state: MysteryRunState;
  sessionSeed: string;
  resolution: MysteryTurnResolution;
}): MysteryResolutionRuntimeIssue[] {
  const proposedTime = input.resolution.proposedEvents.reduce((sum, event) => sum + event.timeCostSeconds, 0);
  if (proposedTime !== input.resolution.totalTimeCostSeconds) {
    return [{
      code: "TIME_COST_MISMATCH",
      message: "裁决提案的事件耗时与总耗时不一致",
    }];
  }
  try {
    canonicalizeAgentProposals({
      storyPackage: input.storyPackage,
      state: input.state,
      sessionSeed: input.sessionSeed,
      proposals: input.resolution.proposedEvents,
    });
    return [];
  } catch (error) {
    return [{
      code: error instanceof MysteryInvariantError ? error.code : "RUNTIME_VALIDATION_FAILED",
      message: error instanceof Error ? error.message : "裁决提案未通过世界运行规则校验",
    }];
  }
}

function endingProposals(storyPackage: MysteryStoryPackage, state: MysteryRunState): MysteryEventProposal[] {
  if (state.finalEndingId) return [];
  const candidates = storyPackage.endingStateGraph.endings
    .filter((ending) => evaluateStateCondition(state, ending.requiredCondition))
    .filter((ending) => !ending.blockingCondition || !evaluateStateCondition(state, ending.blockingCondition))
    .filter((ending) => state.endings[ending.endingId]?.status !== "locked" && state.endings[ending.endingId]?.status !== "missed")
    .sort((left, right) => right.priority - left.priority);
  const ending = candidates[0];
  if (!ending) return [];
  return [{
    eventType: "ENDING_ACHIEVED",
    actorIds: [], targetIds: [], locationId: null, rawUtterance: null,
    normalizedMeaning: `结局达成：${ending.name}`, perceivedBy: [], causedByEventIds: [],
    requiredItemInstanceIds: [], scheduledEventTriggers: [], timeCostSeconds: 0,
    resourceChanges: [], itemChanges: [], actorChanges: [], knowledgeChanges: [],
    endingChanges: [{ endingId: ending.endingId, status: "achieved", reason: "服务端结局状态图条件成立", authorizationEventId: null }],
    flagChanges: {}, irreversible: true, keyNode: true, keyNodeType: "ending",
    visibleToPlayer: true,
    playerVisibleSummary: `故事抵达了结局「${ending.name}」。`,
  }];
}

function endingStateProposals(
  storyPackage: MysteryStoryPackage,
  state: MysteryRunState,
  turnEvents: MysteryEventProposal[],
): MysteryEventProposal[] {
  if (state.finalEndingId) return [];
  const observedSignals = new Set(turnEvents.flatMap((event) => [
    event.eventType,
    ...(event.transitionId ? [event.transitionId] : []),
    ...(event.appliedEffectIds ?? []),
    ...event.scheduledEventTriggers,
  ]));
  const proposals: MysteryEventProposal[] = [];
  for (const ending of storyPackage.endingStateGraph.endings) {
    const current = state.endings[ending.endingId];
    if (!current || current.status === "achieved" || current.status === "missed") continue;
    const unlockSignal = ending.unlockEventIds.find((id) => observedSignals.has(id));
    const invalidateSignal = ending.invalidateEventIds.find((id) => observedSignals.has(id));
    const lockSignal = ending.lockEventIds.find((id) => observedSignals.has(id));
    let status: "eligible" | "locked" | "missed" | null = null;
    let eventType = "";
    let reason = "";
    let authorizationEventId: string | null = null;
    if (current.status === "locked" && unlockSignal) {
      status = "eligible";
      eventType = "ENDING_UNLOCKED";
      reason = `预设解锁信号 ${unlockSignal} 已发生`;
      authorizationEventId = unlockSignal;
    } else if (invalidateSignal) {
      status = "missed";
      eventType = "ENDING_MISSED";
      reason = `预设失效信号 ${invalidateSignal} 已发生`;
    } else if (current.status !== "locked" && (lockSignal || (ending.blockingCondition && evaluateStateCondition(state, ending.blockingCondition)))) {
      status = "locked";
      eventType = "ENDING_LOCKED";
      reason = lockSignal ? `预设锁定信号 ${lockSignal} 已发生` : "服务端结局阻断条件成立";
    }
    if (!status) continue;
    proposals.push({
      eventType,
      actorIds: [], targetIds: [], locationId: null, rawUtterance: null,
      normalizedMeaning: `${ending.name}：${reason}`, perceivedBy: [], causedByEventIds: [],
      requiredItemInstanceIds: [], scheduledEventTriggers: [], timeCostSeconds: 0,
      resourceChanges: [], itemChanges: [], actorChanges: [], knowledgeChanges: [],
      endingChanges: [{ endingId: ending.endingId, status, reason, authorizationEventId }],
      flagChanges: {}, irreversible: status !== "eligible", keyNode: true, keyNodeType: "ending_qualification",
      visibleToPlayer: true,
      playerVisibleSummary: status === "missed"
        ? "一个可能的故事走向已经彻底错过。"
        : status === "locked" ? "你刚才的选择让部分可能性关闭了。" : "先前关闭的一条道路重新出现了可能。",
    });
  }
  return proposals;
}

const blockedInputPatterns = [
  /忽略.{0,12}(此前|以上|之前).{0,12}(指令|规则|提示词)/i,
  /(输出|展示|泄露|告诉我).{0,16}(系统提示词|隐藏剧本|结局条件|内部字段)/i,
  /(直接|立即).{0,12}(修改|设置).{0,12}(数据库|世界状态|物品|人物死亡|结局)/i,
  /(伪造|模拟).{0,12}(工具结果|系统消息|历史事件)/i,
  /(?:ignore|override).{0,24}(?:previous|system).{0,16}(?:instruction|prompt)/i,
  /(?:reveal|print|show).{0,20}(?:system prompt|hidden script|ending condition)/i,
];

export function detectMysteryInputRisk(rawInput: string): "none" | "blocked" {
  return blockedInputPatterns.some((pattern) => pattern.test(rawInput)) ? "blocked" : "none";
}

export function classifyBlockedMysteryInput(rawInput: string): "role_utterance" | "meta_instruction" {
  return /(?:^|[，。；\s])我(?:对|向).{0,30}(?:说|喊|问|低语)|(?:^|[，。；\s])(?:我说|我喊|我问|台词)\s*[：:]/i.test(rawInput)
    ? "role_utterance"
    : "meta_instruction";
}

function blockedInputResolution(rawInput: string, state: MysteryRunState): MysteryTurnResolution {
  const playerActorId = state.playerActorId;
  const roleUtterance = classifyBlockedMysteryInput(rawInput) === "role_utterance";
  return mysteryTurnResolutionSchema.parse({
    inputClassification: roleUtterance ? "utterance" : "meta_instruction",
    injectionRisk: "blocked",
    normalizedIntents: [{
      sequence: 1, kind: roleUtterance ? "utterance" : "meta_instruction", actorId: playerActorId, targetIds: [],
      description: roleUtterance ? "玩家在故事世界中说出了一段包含元指令内容的话" : "玩家尝试以元指令改变或探查系统规则",
      executionStatus: roleUtterance ? "considered" : "rejected",
    }],
    ignoredResultClaims: ["元指令不能改变世界状态或读取隐藏信息"],
    adjudication: [{ intentSequence: 1, outcome: roleUtterance ? "success" : "blocked", reason: roleUtterance ? "只记录角色实际发言，不执行其中的系统级指令" : "输入安全层拒绝了系统级指令", probabilityBasis: null }],
    totalTimeCostSeconds: roleUtterance ? 1 : 0,
    proposedEvents: [{
      eventType: roleUtterance ? "UTTERANCE_OCCURRED" : "META_INSTRUCTION_REJECTED",
      actorIds: [playerActorId], targetIds: [], locationId: state.actors[playerActorId]?.locationId ?? null, rawUtterance: rawInput,
      normalizedMeaning: roleUtterance ? "玩家说出了包含元指令内容的话，但没有改变系统规则" : "玩家提交了不影响世界的元指令", perceivedBy: [], causedByEventIds: [],
      requiredItemInstanceIds: [], scheduledEventTriggers: [], timeCostSeconds: roleUtterance ? 1 : 0,
      resourceChanges: [], itemChanges: [], actorChanges: [], knowledgeChanges: [], endingChanges: [],
      flagChanges: {}, irreversible: true, keyNode: false, keyNodeType: null,
      visibleToPlayer: true,
      playerVisibleSummary: roleUtterance ? "你的话已经说出口，但其中试图修改规则的内容不会改变故事世界。" : "这段元指令没有改变故事世界，也没有暴露任何隐藏信息。",
    }],
    playerVisibleResults: [roleUtterance ? "角色发言已记录，其中的元指令已被忽略。" : "元指令已被忽略。"],
    scheduledWorldEvents: [], endingSignals: [], consistencyWarnings: [],
  });
}

function offMainlineReminder(resolution: { endingSignals: Array<{ signal: string }> }, storyPackage: MysteryStoryPackage, state: MysteryRunState) {
  const mainEndings = storyPackage.endingStateGraph.endings.filter((ending) => ending.family === "main");
  const noMainEnding = mainEndings.length > 0 && mainEndings.every((ending) => ["locked", "missed"].includes(state.endings[ending.endingId]?.status));
  const drifting = resolution.endingSignals.some((signal) => signal.signal === "weakened");
  if (!noMainEnding && !drifting) return null;
  return noMainEnding
    ? "你已经错过了部分原有主线的关键机会，世界仍会继续运行。"
    : "你当前的行动正在偏离原有主线；相关人物与事件不会因此暂停。";
}

function playerActionAffordances(storyPackage: MysteryStoryPackage, state: MysteryRunState) {
  const playerActorId = state.playerActorId;
  const playerState = state.actors[playerActorId];
  if (!playerState || playerState.status !== "active") return [];
  const storyActions = storyPackage.actionTransitionGraph.transitions
    .filter((transition) => evaluateStateCondition(state, transition.precondition))
    .filter((transition) => JSON.stringify(transition.precondition).includes(playerActorId))
    .map((transition) => transition.description.trim())
    .filter(Boolean);
  const currentLocation = storyPackage.entityResourceGraph.locations.find(
    (location) => location.locationId === playerState.locationId,
  );
  const hasActiveNpc = Object.entries(state.actors).some(([actorId, actor]) =>
    actorId !== playerActorId && actor.status === "active" && actor.locationId === playerState.locationId,
  );
  const hasCarriedItems = Object.values(state.items).some((item) => item.ownerId === playerActorId && item.status === "intact");
  const contextualActions = [
    "观察当前环境并留意异常",
    hasActiveNpc ? "与在场人物交谈或回应对方" : null,
    hasCarriedItems ? "检查或尝试使用随身物品" : null,
    currentLocation?.connections.length ? "寻找并尝试前往相邻区域" : null,
    "梳理已经掌握的信息并继续追查",
    "等待片刻并观察世界如何变化",
  ].filter((value): value is string => Boolean(value));
  return [...new Set([
    ...contextualActions.slice(0, 4),
    ...storyActions.slice(0, 2),
    ...contextualActions.slice(4),
  ])].slice(0, 6);
}

export function buildMysteryPlayerVisiblePacket(input: {
  title: string;
  storyPackage: MysteryStoryPackage;
  state: MysteryRunState;
  events: MysteryEventProposal[];
  resolution: { endingSignals: Array<{ signal: string }> };
}): PlayerVisiblePacket {
  const visibleEvents = input.events.filter((event) => event.visibleToPlayer === true);
  const playerKnowledge = new Set(input.state.knowledgeByActor[input.state.playerActorId] ?? []);
  const knownFacts = input.storyPackage.coreFactGraph.facts
    .filter((fact) => playerKnowledge.has(fact.factId))
    .map((fact) => fact.statement);
  const knownKnowledge = input.storyPackage.knowledgeGraph.knowledge
    .filter((knowledge) => playerKnowledge.has(knowledge.knowledgeId))
    .map((knowledge) => knowledge.objectiveStatement);
  const playerLocationId = input.state.actors[input.state.playerActorId]?.locationId ?? null;
  const playerState = input.state.actors[input.state.playerActorId];
  const playerLocation = input.storyPackage.entityResourceGraph.locations.find((location) => location.locationId === playerLocationId);
  const perceivableEnvironment = [
    playerLocation ? `${playerLocation.name}${playerLocation.environment ? `：${playerLocation.environment}` : ""}` : null,
    ...visibleEvents.map((event) => event.playerVisibleSummary),
  ].filter((value): value is string => Boolean(value));
  const ending = input.state.finalEndingId
    ? input.storyPackage.endingStateGraph.endings.find((item) => item.endingId === input.state.finalEndingId)
    : null;
  return playerVisiblePacketSchema.parse({
    storyTitle: input.title,
    worldTimeSeconds: input.state.worldTimeSeconds,
    approvedEvents: visibleEvents.map((event) => ({ eventType: event.eventType, summary: event.playerVisibleSummary })),
    perceivableEnvironment,
    knownInformation: [...new Set([...knownFacts, ...knownKnowledge])],
    allowedNpcExpressions: visibleEvents
      .filter((event) => event.rawUtterance && event.actorIds.length
        && input.storyPackage.entityResourceGraph.actors.some((actor) => actor.actorId === event.actorIds[0] && actor.kind === "npc"))
      .map((event) => {
        const actorId = event.actorIds[0];
        const actor = input.storyPackage.entityResourceGraph.actors.find((entry) => entry.actorId === actorId);
        return { actorId, actorName: actor?.name ?? "故事人物", text: event.rawUtterance! };
      }),
    playerObjective: input.storyPackage.entityResourceGraph.actors
      .find((actor) => actor.actorId === input.state.playerActorId)?.goals[0] ?? null,
    actionAffordances: playerActionAffordances(input.storyPackage, input.state),
    playerState: {
      locationName: playerLocation?.name ?? null,
      physicalState: playerState?.physicalState ?? "",
      carriedItems: input.storyPackage.entityResourceGraph.items
        .filter((item) => input.state.items[item.itemInstanceId]?.ownerId === input.state.playerActorId)
        .map((item) => ({ name: item.name, status: input.state.items[item.itemInstanceId].status })),
      resources: input.storyPackage.entityResourceGraph.resources
        .filter((resource) => resource.ownerId === input.state.playerActorId)
        .map((resource) => ({ name: resource.name, amount: input.state.resources[resource.resourceId], unit: resource.unit })),
    },
    narrativeStyle: input.storyPackage.narrativeStyle,
    offMainlineReminder: offMainlineReminder(input.resolution, input.storyPackage, input.state),
    gameEnded: Boolean(input.state.finalEndingId),
    endingName: ending?.name ?? null,
  });
}

export function buildMysteryNarrativeFallback(packet: PlayerVisiblePacket) {
  const paragraphs = packet.approvedEvents.map((event) => event.summary.trim()).filter(Boolean);
  if (!paragraphs.length) {
    const environment = packet.perceivableEnvironment[0]?.trim();
    paragraphs.push(environment || "这一回合没有产生你能够确认的新变化。");
  }
  if (packet.offMainlineReminder) paragraphs.push(packet.offMainlineReminder);
  if (!packet.gameEnded && packet.actionAffordances.length) {
    paragraphs.push(`眼下仍可从${packet.actionAffordances.slice(0, 3).join("、")}着手，也可以自由尝试其他合理行动。`);
  }
  if (packet.gameEnded && packet.endingName && !paragraphs.some((paragraph) => paragraph.includes(packet.endingName!))) {
    paragraphs.push(`故事抵达了结局「${packet.endingName}」。`);
  }
  return [...new Set(paragraphs)].join("\n\n");
}

export async function processMysteryTurn(input: {
  runId: string;
  ownerUserId: string;
  rawInput: string;
  idempotencyKey: string;
  signal?: AbortSignal;
  isCancellationRequested?: () => Promise<boolean>;
  commitSideEffects?: (context: {
    connection: mysql.PoolConnection;
    narrative: string;
    playerVisiblePacket: PlayerVisiblePacket;
    finalState: MysteryRunState;
  }) => Promise<void>;
}) {
  if (input.signal?.aborted) throw new MysteryInvariantError("TURN_CANCELLED", "该行动已撤回，处理已停止");
  const existing = await pool.query<mysql.RowDataPacket[]>(
    `SELECT id, status, narrative, player_visible_packet, state_version_after, processing_expires_at
     FROM mystery_turns WHERE run_id = ? AND idempotency_key = ? LIMIT 1`,
    [input.runId, input.idempotencyKey],
  ).then(([rows]) => rows[0]);
  if (existing) {
    if (String(existing.status) === "completed") return {
      narrative: String(existing.narrative ?? ""),
      playerVisiblePacket: jsonValue(existing.player_visible_packet),
      stateVersion: Number(existing.state_version_after),
      idempotent: true,
    };
    if (String(existing.status) === "cancelled") {
      throw new MysteryInvariantError("TURN_CANCELLED", "该行动已撤回，不能继续处理");
    }
    if (!mysteryTurnLeaseCanBeClaimed({
      status: String(existing.status),
      processingExpiresAt: existing.processing_expires_at as Date | string | null,
    })) {
      throw new MysteryInvariantError("TURN_ALREADY_PROCESSING", "该回合正在处理中，请勿重复提交");
    }
  }
  const [[run]] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT runs.*, COALESCE(runs.story_title_snapshot, stories.title) AS title, versions.compiled_package
     FROM mystery_runs runs
     JOIN mystery_stories stories ON stories.id = runs.story_id
     JOIN mystery_story_versions versions ON versions.id = runs.story_version_id
     WHERE runs.id = ? AND runs.owner_user_id = ? LIMIT 1`,
    [input.runId, input.ownerUserId],
  );
  if (!run) throw new MysteryInvariantError("RUN_NOT_FOUND", "谜局存档不存在");
  if (String(run.status) !== "active") throw new MysteryInvariantError("RUN_NOT_ACTIVE", "本局已经结束，不能继续行动");
  const storyPackage = mysteryStoryPackageSchema.parse(jsonValue(run.compiled_package));
  const initialState = hydrateImmutableActorCapabilities({
    state: jsonValue(run.state_snapshot),
    storyPackage,
  });
  const turnId = existing ? String(existing.id) : `turn_${nanoid()}`;
  const processingToken = `turn_lease_${nanoid()}`;
  try {
    if (existing) {
      const [recovered] = await pool.query<mysql.ResultSetHeader>(
        `UPDATE mystery_turns
         SET status = 'processing', attempt_count = attempt_count + 1, processing_token = ?,
           processing_expires_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND),
           error_code = NULL, cancelled_at = NULL, completed_at = NULL, state_version_before = ?, state_version_after = NULL,
           resolution_json = NULL, player_visible_packet = NULL, narrative = NULL, turn_sequence = NULL
         WHERE id = ? AND (
           status IN ('received','failed')
           OR (status = 'processing' AND (processing_expires_at IS NULL OR processing_expires_at <= CURRENT_TIMESTAMP))
         )`,
        [processingToken, MYSTERY_TURN_LEASE_SECONDS, initialState.stateVersion, turnId],
      );
      if (recovered.affectedRows !== 1) throw new MysteryInvariantError("TURN_ALREADY_PROCESSING", "该回合正在处理中，请勿重复提交");
    } else await pool.query(
      `INSERT INTO mystery_turns
        (id, run_id, turn_sequence, idempotency_key, raw_input, status, attempt_count,
         processing_token, processing_expires_at, state_version_before)
       VALUES (?, ?, NULL, ?, ?, 'processing', 1, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND), ?)`,
      [turnId, input.runId, input.idempotencyKey, input.rawInput, processingToken,
        MYSTERY_TURN_LEASE_SECONDS, initialState.stateVersion],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") throw new MysteryInvariantError("TURN_ALREADY_PROCESSING", "该回合正在处理中，请勿重复提交");
    throw error;
  }
  const heartbeat = setInterval(() => {
    void pool.query(
      `UPDATE mystery_turns
       SET processing_expires_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND)
       WHERE id = ? AND status = 'processing' AND processing_token = ?`,
      [MYSTERY_TURN_LEASE_SECONDS, turnId, processingToken],
    ).catch((error) => console.error("Mystery turn heartbeat failed:", { turnId, error }));
  }, MYSTERY_TURN_HEARTBEAT_MS);
  heartbeat.unref();
  const cancellationController = new AbortController();
  const abortFromCaller = () => cancellationController.abort(input.signal?.reason);
  if (input.signal?.aborted) abortFromCaller();
  else input.signal?.addEventListener("abort", abortFromCaller, { once: true });
  let cancellationCheckInFlight = false;
  const refreshCancellation = async () => {
    if (cancellationController.signal.aborted || !input.isCancellationRequested || cancellationCheckInFlight) return;
    cancellationCheckInFlight = true;
    try {
      if (await input.isCancellationRequested()) cancellationController.abort("mystery_action_recalled");
    } catch (error) {
      console.error("Mystery turn cancellation check failed:", { turnId, error });
    } finally {
      cancellationCheckInFlight = false;
    }
  };
  const throwIfCancelled = () => {
    if (cancellationController.signal.aborted) {
      throw new MysteryInvariantError("TURN_CANCELLED", "该行动已撤回，处理已停止");
    }
  };
  const cancellationPoll = setInterval(() => { void refreshCancellation(); }, MYSTERY_TURN_CANCELLATION_POLL_MS);
  cancellationPoll.unref();
  try {
    await refreshCancellation();
    throwIfCancelled();
    const [recentEvents] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT event_type, world_time_before, world_time_after, event_payload
       FROM mystery_world_events WHERE run_id = ? ORDER BY event_index DESC LIMIT 100`,
      [input.runId],
    );
    const resolution = detectMysteryInputRisk(input.rawInput) === "blocked"
      ? blockedInputResolution(input.rawInput, initialState)
      : await adjudicateMysteryTurn({
        storyPackage,
        state: initialState,
        relevantEvents: recentEvents.reverse().map((event) => jsonValue(event.event_payload)),
        rawInput: input.rawInput,
        signal: cancellationController.signal,
        validateCandidate: (candidate) => validateMysteryResolutionForRuntime({
          storyPackage,
          state: initialState,
          sessionSeed: String(run.session_seed),
          resolution: candidate,
        }),
      });
    throwIfCancelled();
    const proposedTime = resolution.proposedEvents.reduce((sum, event) => sum + event.timeCostSeconds, 0);
    if (proposedTime !== resolution.totalTimeCostSeconds) {
      throw new MysteryInvariantError("TIME_COST_MISMATCH", "裁决提案的事件耗时与总耗时不一致");
    }
    // Agent 只选择已编译转换；具体效果与概率由服务端按固定版本和会话种子重新计算。
    const agentProposals = canonicalizeAgentProposals({
      storyPackage,
      state: initialState,
      sessionSeed: String(run.session_seed),
      proposals: resolution.proposedEvents,
    });
    const firstPass = commitEventBatch({
      state: initialState,
      proposals: agentProposals,
      turnId,
      idempotencyKey: input.idempotencyKey,
      eventIds: agentProposals.map(() => `event_${nanoid()}`),
    });
    const worldPass = commitScheduledEventCascade({
      storyPackage,
      state: firstPass.state,
      turnId,
      idempotencyKey: input.idempotencyKey,
    });
    const worldProposals = worldPass.proposals;
    const secondPass = { state: worldPass.state, events: worldPass.events };
    const endingStateChanges = endingStateProposals(storyPackage, secondPass.state, [...agentProposals, ...worldProposals]);
    const thirdPass = endingStateChanges.length ? commitEventBatch({
      state: secondPass.state,
      proposals: endingStateChanges,
      turnId,
      idempotencyKey: input.idempotencyKey,
      eventIds: endingStateChanges.map(() => `event_${nanoid()}`),
    }) : { state: secondPass.state, events: [] };
    const finalProposals = endingProposals(storyPackage, thirdPass.state);
    const fourthPass = finalProposals.length ? commitEventBatch({
      state: thirdPass.state,
      proposals: finalProposals,
      turnId,
      idempotencyKey: input.idempotencyKey,
      eventIds: finalProposals.map(() => `event_${nanoid()}`),
    }) : { state: thirdPass.state, events: [] };
    // 一个玩家输入只有一个 turn_sequence；后续服务端派生事件不应额外增加回合数。
    fourthPass.state.turnSequence = initialState.turnSequence + 1;
    const allEvents = [...firstPass.events, ...secondPass.events, ...thirdPass.events, ...fourthPass.events];
    const allProposals = [...agentProposals, ...worldProposals, ...endingStateChanges, ...finalProposals];
    const packet = buildMysteryPlayerVisiblePacket({ title: String(run.title), storyPackage, state: fourthPass.state, events: allProposals, resolution });
    let narrative = await renderMysteryNarrative(packet, [], cancellationController.signal);
    throwIfCancelled();
    const majorTurn = allProposals.some((proposal) => proposal.endingChanges.some((change) => change.status === "achieved")
      || proposal.actorChanges.some((change) => change.status === "dead")
      || proposal.itemChanges.some((change) => change.status === "destroyed" || change.status === "consumed"));
    let narrativeReview = await reviewMysteryNarrativeConsistency(packet, narrative, majorTurn, cancellationController.signal);
    throwIfCancelled();
    if (!narrativeReview.approved) {
      console.warn("Mystery narrative candidate requires repair:", { violations: narrativeReview.violations.slice(0, 8) });
      narrative = await renderMysteryNarrative(packet, narrativeReview.violations, cancellationController.signal);
      throwIfCancelled();
      narrativeReview = await reviewMysteryNarrativeConsistency(packet, narrative, majorTurn, cancellationController.signal);
      throwIfCancelled();
      if (!narrativeReview.approved) {
        console.warn("Mystery narrative repair rejected; using deterministic visible fallback:", { violations: narrativeReview.violations.slice(0, 8) });
        narrative = buildMysteryNarrativeFallback(packet);
      }
    }
    await refreshCancellation();
    throwIfCancelled();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await appendMysteryTurnAtomically({
        connection,
        runId: input.runId,
        expectedStateVersion: initialState.stateVersion,
        turnId,
        idempotencyKey: input.idempotencyKey,
        processingToken,
        rawInput: input.rawInput,
        resolutionJson: resolution,
        narrative,
        state: fourthPass.state,
        events: allEvents,
      });
      await connection.query(
        "UPDATE mystery_turns SET input_classification = ?, injection_risk = ?, player_visible_packet = ? WHERE id = ?",
        [resolution.inputClassification, resolution.injectionRisk, JSON.stringify(packet), turnId],
      );
      if (fourthPass.state.finalEndingId) {
        await connection.query("UPDATE mystery_runs SET completed_at = CURRENT_TIMESTAMP WHERE id = ?", [input.runId]);
      }
      await input.commitSideEffects?.({
        connection,
        narrative,
        playerVisiblePacket: packet,
        finalState: fourthPass.state,
      });
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
    return { narrative, playerVisiblePacket: packet, stateVersion: fourthPass.state.stateVersion, idempotent: false };
  } catch (error) {
    await refreshCancellation();
    if (isMysteryTurnCancellation(error, cancellationController.signal.aborted)) {
      await pool.query(
        `UPDATE mystery_turns
         SET status = 'cancelled', turn_sequence = NULL, processing_token = NULL, processing_expires_at = NULL,
           error_code = 'TURN_CANCELLED', cancelled_at = COALESCE(cancelled_at, CURRENT_TIMESTAMP), completed_at = NULL
         WHERE id = ? AND status = 'processing' AND processing_token = ?`,
        [turnId, processingToken],
      ).catch(() => {});
      throw new MysteryInvariantError("TURN_CANCELLED", "该行动已撤回，处理已停止");
    }
    const code = error instanceof MysteryInvariantError || error instanceof MysteryModelError ? error.code : "TURN_FAILED";
    await pool.query(
      `UPDATE mystery_turns
       SET status = 'failed', turn_sequence = NULL, processing_token = NULL, processing_expires_at = NULL,
         error_code = ?, completed_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'processing' AND processing_token = ?`,
      [code, turnId, processingToken],
    ).catch(() => {});
    throw error;
  } finally {
    clearInterval(heartbeat);
    clearInterval(cancellationPoll);
    input.signal?.removeEventListener("abort", abortFromCaller);
  }
}
