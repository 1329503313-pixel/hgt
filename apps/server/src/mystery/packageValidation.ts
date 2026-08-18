import type { MysteryStoryPackage, StateCondition } from "./contracts.js";

function duplicateIds(values: string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    else seen.add(value);
  }
  return [...duplicates];
}

function validateConditionReferences(input: {
  condition: StateCondition;
  label: string;
  actorIds: Set<string>;
  locationIds: Set<string>;
  itemIds: Set<string>;
  resourceIds: Set<string>;
  endingIds: Set<string>;
  issues: string[];
}) {
  const { condition } = input;
  if (condition.op === "all" || condition.op === "any") {
    for (const child of condition.conditions) validateConditionReferences({ ...input, condition: child });
    return;
  }
  if (condition.op === "not") {
    validateConditionReferences({ ...input, condition: condition.condition });
    return;
  }
  const segments = condition.path.split(".");
  const [root, entityId] = segments;
  const knownScalarRoots = new Set(["worldTimeSeconds", "stateVersion", "turnSequence", "eventSequence", "finalEndingId"]);
  if (knownScalarRoots.has(root)) {
    if (segments.length !== 1) input.issues.push(`${input.label} 使用了不存在的状态字段 ${condition.path}`);
    return;
  }
  if (root === "triggeredScheduledEventIds") {
    if (segments.length !== 1) input.issues.push(`${input.label} 使用了不存在的状态字段 ${condition.path}`);
    return;
  }
  if (root === "flags") {
    if (segments.length !== 2 || !entityId) input.issues.push(`${input.label} 使用了不合法的世界标记路径 ${condition.path}`);
    return;
  }
  const referenceSets: Record<string, Set<string>> = {
    actors: input.actorIds,
    items: input.itemIds,
    resources: input.resourceIds,
    knowledgeByActor: input.actorIds,
    beliefsByActor: input.actorIds,
    endings: input.endingIds,
  };
  const references = referenceSets[root];
  if (!references) {
    input.issues.push(`${input.label} 使用了未知状态路径 ${condition.path}`);
    return;
  }
  if (!entityId || !references.has(entityId)) {
    input.issues.push(`${input.label} 引用了不存在的状态对象 ${condition.path}`);
    return;
  }
  const allowedFields: Record<string, Set<string>> = {
    actors: new Set(["status", "locationId", "physicalState", "abilities", "weaknesses"]),
    items: new Set(["ownerId", "locationId", "status"]),
    endings: new Set(["status", "reasonEventIds"]),
  };
  if (root === "resources" || root === "knowledgeByActor" || root === "beliefsByActor") {
    if (segments.length !== 2) input.issues.push(`${input.label} 使用了不存在的状态字段 ${condition.path}`);
    return;
  }
  if (segments.length === 2) return;
  if (segments.length !== 3 || !allowedFields[root]?.has(segments[2])) {
    input.issues.push(`${input.label} 使用了不存在的状态字段 ${condition.path}`);
  }
}

export function validateMysteryStoryPackageIntegrity(storyPackage: MysteryStoryPackage) {
  const issues: string[] = [];
  const actors = storyPackage.entityResourceGraph.actors;
  const locations = storyPackage.entityResourceGraph.locations;
  const items = storyPackage.entityResourceGraph.items;
  const resources = storyPackage.entityResourceGraph.resources;
  const facts = storyPackage.coreFactGraph.facts;
  const knowledge = storyPackage.knowledgeGraph.knowledge;
  const effects = storyPackage.actionTransitionGraph.effects;
  const transitions = storyPackage.actionTransitionGraph.transitions;
  const scheduledEvents = storyPackage.timelineGraph.scheduledEvents;
  const endings = storyPackage.endingStateGraph.endings;
  const idGroups: Array<[string, string[]]> = [
    ["人物", actors.map((item) => item.actorId)],
    ["地点", locations.map((item) => item.locationId)],
    ["物品实例", items.map((item) => item.itemInstanceId)],
    ["资源", resources.map((item) => item.resourceId)],
    ["事实", facts.map((item) => item.factId)],
    ["知识", knowledge.map((item) => item.knowledgeId)],
    ["效果", effects.map((item) => item.effectId)],
    ["行动转换", transitions.map((item) => item.transitionId)],
    ["世界事件", scheduledEvents.map((item) => item.scheduledEventId)],
    ["结局", endings.map((item) => item.endingId)],
  ];
  for (const [label, ids] of idGroups) {
    const duplicates = duplicateIds(ids);
    if (duplicates.length) issues.push(`${label} ID 重复：${duplicates.join("、")}`);
  }

  const actorIds = new Set(actors.map((item) => item.actorId));
  const locationIds = new Set(locations.map((item) => item.locationId));
  const itemIds = new Set(items.map((item) => item.itemInstanceId));
  const resourceIds = new Set(resources.map((item) => item.resourceId));
  const factIds = new Set(facts.map((item) => item.factId));
  const knowledgeIds = new Set(knowledge.map((item) => item.knowledgeId));
  const effectIds = new Set(effects.map((item) => item.effectId));
  const transitionIds = new Set(transitions.map((item) => item.transitionId));
  const scheduledEventIds = new Set(scheduledEvents.map((item) => item.scheduledEventId));
  const endingIds = new Set(endings.map((item) => item.endingId));
  const runtimeEndingSignalIds = new Set([
    "ACTION_BLOCKED", "ACTION_FAILED", "ACTION_SUCCEEDED", "WORLD_EVENT_TRIGGERED",
    "UTTERANCE_OCCURRED", "META_INSTRUCTION_REJECTED",
  ]);

  if (actors.filter((actor) => actor.kind === "player").length !== 1) issues.push("Story Package 必须且只能包含一个玩家角色");
  for (const actor of actors) {
    if (!locationIds.has(actor.initialLocationId)) issues.push(`人物 ${actor.actorId} 的初始地点不存在`);
    if (actor.kind === "npc" && actor.currentPlan.trim() && actor.scheduleIds.length === 0) {
      issues.push(`人物 ${actor.actorId} 配置了当前计划，但没有关联推动计划的世界事件`);
    }
    for (const scheduleId of actor.scheduleIds) if (!scheduledEventIds.has(scheduleId)) issues.push(`人物 ${actor.actorId} 引用了不存在的世界事件 ${scheduleId}`);
    for (const factId of [...actor.knownFactIds, ...actor.unknownFactIds, ...actor.mistakenFactIds]) {
      if (!factIds.has(factId) && !knowledgeIds.has(factId)) issues.push(`人物 ${actor.actorId} 引用了不存在的事实或知识 ${factId}`);
    }
    for (const secretId of actor.secretIds) if (!factIds.has(secretId) && !knowledgeIds.has(secretId)) issues.push(`人物 ${actor.actorId} 引用了不存在的秘密 ${secretId}`);
  }
  for (const location of locations) {
    for (const connection of location.connections) if (!locationIds.has(connection.toLocationId)) issues.push(`地点 ${location.locationId} 通向不存在的地点 ${connection.toLocationId}`);
    for (const actorId of location.initialActorIds) {
      const actor = actors.find((entry) => entry.actorId === actorId);
      if (!actor) issues.push(`地点 ${location.locationId} 引用了不存在的人物 ${actorId}`);
      else if (actor.initialLocationId !== location.locationId) issues.push(`人物 ${actorId} 的初始地点配置相互冲突`);
    }
    for (const itemId of location.initialItemInstanceIds) {
      const item = items.find((entry) => entry.itemInstanceId === itemId);
      if (!item) issues.push(`地点 ${location.locationId} 引用了不存在的物品 ${itemId}`);
      else if (item.initialLocationId !== location.locationId || item.initialOwnerId) issues.push(`物品 ${itemId} 的初始位置或所有权配置相互冲突`);
    }
  }
  for (const item of items) {
    if (item.initialOwnerId && !actorIds.has(item.initialOwnerId)) issues.push(`物品 ${item.itemInstanceId} 的初始所有者不存在`);
    if (item.initialLocationId && !locationIds.has(item.initialLocationId)) issues.push(`物品 ${item.itemInstanceId} 的初始地点不存在`);
    if (item.initialOwnerId && item.initialLocationId) issues.push(`物品 ${item.itemInstanceId} 不能同时设置初始所有者和初始地点`);
    for (const actorId of item.recognizedByActorIds) if (!actorIds.has(actorId)) issues.push(`物品 ${item.itemInstanceId} 引用了不存在的识别人物 ${actorId}`);
    for (const effectId of [...item.useEffectIds, ...item.destructionConsequenceIds]) {
      if (!effectIds.has(effectId)) issues.push(`物品 ${item.itemInstanceId} 引用了不存在的效果 ${effectId}`);
    }
  }
  for (const resource of resources) {
    if (!actorIds.has(resource.ownerId)) issues.push(`资源 ${resource.resourceId} 的所有者不存在`);
    if (resource.minimum < 0) issues.push(`资源 ${resource.resourceId} 的最小值不能小于 0`);
    if (resource.maximum != null && resource.maximum < resource.minimum) issues.push(`资源 ${resource.resourceId} 的最大值不能小于最小值`);
    if (resource.initialAmount < resource.minimum || (resource.maximum != null && resource.initialAmount > resource.maximum)) {
      issues.push(`资源 ${resource.resourceId} 的初始值超出允许范围`);
    }
  }
  for (const entry of knowledge) {
    for (const actorId of [...entry.holderActorIds, ...entry.mistakenHolderActorIds, ...entry.affectedActorIds]) {
      if (!actorIds.has(actorId)) issues.push(`知识 ${entry.knowledgeId} 引用了不存在的人物 ${actorId}`);
    }
    for (const itemId of entry.evidenceItemIds) if (!itemIds.has(itemId)) issues.push(`知识 ${entry.knowledgeId} 引用了不存在的证据物品 ${itemId}`);
    for (const locationId of entry.evidenceLocationIds) if (!locationIds.has(locationId)) issues.push(`知识 ${entry.knowledgeId} 引用了不存在的证据地点 ${locationId}`);
    for (const endingId of entry.relatedEndingIds) if (!endingIds.has(endingId)) issues.push(`知识 ${entry.knowledgeId} 引用了不存在的结局 ${endingId}`);
  }
  for (const transition of transitions) {
    for (const effectId of [...transition.successEffectIds, ...transition.failureEffectIds]) {
      if (!effectIds.has(effectId)) issues.push(`行动转换 ${transition.transitionId} 引用了不存在的效果 ${effectId}`);
    }
    if (!transition.deterministic && transition.baseSuccessProbability == null) issues.push(`概率行动 ${transition.transitionId} 缺少基础概率`);
    validateConditionReferences({ condition: transition.precondition, label: `行动转换 ${transition.transitionId}`, actorIds, locationIds, itemIds, resourceIds, endingIds, issues });
    for (const factor of transition.probabilityFactors) validateConditionReferences({ condition: factor.condition, label: `行动转换 ${transition.transitionId} 的概率因素`, actorIds, locationIds, itemIds, resourceIds, endingIds, issues });
  }
  for (const effect of effects) {
    for (const change of effect.resourceChanges) if (!resourceIds.has(change.resourceId)) issues.push(`效果 ${effect.effectId} 引用了不存在的资源 ${change.resourceId}`);
    for (const change of effect.itemChanges) {
      if (!itemIds.has(change.itemInstanceId)) issues.push(`效果 ${effect.effectId} 引用了不存在的物品 ${change.itemInstanceId}`);
      if (change.ownerId && !actorIds.has(change.ownerId)) issues.push(`效果 ${effect.effectId} 引用了不存在的物品所有者 ${change.ownerId}`);
      if (change.locationId && !locationIds.has(change.locationId)) issues.push(`效果 ${effect.effectId} 引用了不存在的物品地点 ${change.locationId}`);
    }
    for (const change of effect.actorChanges) {
      if (!actorIds.has(change.actorId)) issues.push(`效果 ${effect.effectId} 引用了不存在的人物 ${change.actorId}`);
      if (change.locationId && !locationIds.has(change.locationId)) issues.push(`效果 ${effect.effectId} 引用了不存在的人物地点 ${change.locationId}`);
    }
    for (const change of effect.knowledgeChanges) {
      if (!actorIds.has(change.actorId)) issues.push(`效果 ${effect.effectId} 引用了不存在的认知人物 ${change.actorId}`);
      if (!knowledgeIds.has(change.knowledgeId)) issues.push(`效果 ${effect.effectId} 引用了不存在的知识 ${change.knowledgeId}`);
    }
  }
  for (const event of scheduledEvents) {
    for (const effectId of event.effectIds) if (!effectIds.has(effectId)) issues.push(`世界事件 ${event.scheduledEventId} 引用了不存在的效果 ${effectId}`);
    for (const locationId of [...event.visibleToLocationIds, ...event.audibleToLocationIds]) {
      if (!locationIds.has(locationId)) issues.push(`世界事件 ${event.scheduledEventId} 引用了不存在的感知地点 ${locationId}`);
    }
    if (event.playerVisible && !event.playerVisibleSummary) issues.push(`玩家可见世界事件 ${event.scheduledEventId} 缺少可见摘要`);
    if (event.triggerCondition) validateConditionReferences({ condition: event.triggerCondition, label: `世界事件 ${event.scheduledEventId}`, actorIds, locationIds, itemIds, resourceIds, endingIds, issues });
  }
  for (const ending of endings) {
    validateConditionReferences({ condition: ending.requiredCondition, label: `结局 ${ending.endingId}`, actorIds, locationIds, itemIds, resourceIds, endingIds, issues });
    if (ending.blockingCondition) validateConditionReferences({ condition: ending.blockingCondition, label: `结局 ${ending.endingId}`, actorIds, locationIds, itemIds, resourceIds, endingIds, issues });
    for (const eventId of [...ending.lockEventIds, ...ending.unlockEventIds, ...ending.invalidateEventIds]) {
      if (!scheduledEventIds.has(eventId) && !transitionIds.has(eventId) && !effectIds.has(eventId) && !runtimeEndingSignalIds.has(eventId)) {
        issues.push(`结局 ${ending.endingId} 引用了不存在的行动、效果或世界事件 ${eventId}`);
      }
    }
  }
  for (const endingId of storyPackage.endingStateGraph.fallbackEndingIds) {
    const ending = endings.find((entry) => entry.endingId === endingId);
    if (!ending) issues.push(`兜底结局 ${endingId} 不存在`);
    else if (ending.family === "main") issues.push(`兜底结局 ${endingId} 不能属于主线结局`);
  }
  const fallbackIds = new Set(storyPackage.endingStateGraph.fallbackEndingIds);
  const nonFallbackPriorities = endings.filter((ending) => !fallbackIds.has(ending.endingId)).map((ending) => ending.priority);
  const weakestNonFallbackPriority = nonFallbackPriorities.length ? Math.min(...nonFallbackPriorities) : null;
  if (weakestNonFallbackPriority != null) {
    for (const ending of endings.filter((entry) => fallbackIds.has(entry.endingId))) {
      if (ending.priority >= weakestNonFallbackPriority) issues.push(`兜底结局 ${ending.endingId} 的优先级必须低于非兜底结局，避免提前抢占结局`);
    }
  }
  if (!storyPackage.endingStateGraph.fallbackEndingIds.length) issues.push("至少配置一个偏航、旁观、失败、死亡、超时或脱离主线兜底结局");
  return [...new Set(issues)];
}
