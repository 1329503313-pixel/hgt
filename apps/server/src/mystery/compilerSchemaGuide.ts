export const MYSTERY_COMPILER_SCHEMA_GUIDE = String.raw`以下是必须严格遵守的 schemaVersion=1 结构样例。数组中的对象展示该元素的完整字段集合；请按故事内容扩展，不要复制 EXAMPLE ID。状态条件可以递归使用 all、any、not，或使用 {"op":"eq|neq|gt|gte|lt|lte|includes|exists","path":"...","value":...}。

运行时路径必须匹配真实状态：人物使用 actors.ID.status/locationId/physicalState；人物预设能力和弱点分别使用 actors.ID.abilities、actors.ID.weaknesses，并通过 includes 与完整文本匹配；物品使用 items.ID.ownerId/locationId/status，资源本身就是数值，必须写 resources.ID（严禁 resources.ID.amount/value），知识与误解使用 knowledgeByActor.ID、beliefsByActor.ID，结局使用 endings.ID.status，世界标记使用 flags.KEY，时间使用 worldTimeSeconds。物品初始状态只能采用一种来源：若设置 initialOwnerId，则 initialLocationId 必须为 null，且所有地点的 initialItemInstanceIds 均不得包含该物品；只有无初始所有者的物品才能同时通过自身 initialLocationId 和对应地点 initialItemInstanceIds 表示摆放位置。同一个世界事件同时配置 triggerAtWorldSecond 与 triggerCondition 时表示“到点并且条件成立”。0 秒初始化事件可用于提交初始世界标记。结局 priority 数字越大越先结算；明确结局必须高于 fallbackEndingIds 中的宽泛兜底结局。任何 successEffectIds、failureEffectIds、effectIds、useEffectIds 或 destructionConsequenceIds 中的非空值，都必须精确引用 actionTransitionGraph.effects 中已经定义的 effectId；用于推动人物计划或世界变化的引用必须补齐真实效果对象，不能通过删除引用或创建无意义空效果绕过。

人物不能只停留在静态介绍：每个填写 currentPlan 的 NPC 都必须通过 scheduleIds 关联至少一个能够推动该计划的世界事件，并配置面对玩家接触、质问、阻拦或关键线索时可复用的行动转换。行动转换 description 只能描述玩家能够理解的尝试本身，不得写入成功结果、隐藏秘密或结局条件；玩家可执行转换的 precondition 必须引用玩家 actorId，NPC 专属转换必须引用对应 NPC actorId，便于运行时安全区分行动方向。

枚举约束：factKind=world_rule/past_event/identity/location/possession/resource/objective_fact/belief/rumor/misunderstanding/plan/secret/clue/trigger/ending_condition/prohibition；truthStatus=true/false/undetermined；mutability=immutable/session_initialized/deferred/runtime_mutable/forbidden；commitStatus=committed/uncommitted；playerVisibility=visible/hidden/discoverable；persistence=permanent/run；actor kind=player/npc；actor status=active/incapacitated/missing/dead；searchDifficulty=trivial/ordinary/trained/expert/impossible；knowledge kind=truth/secret/clue/rumor/lie/misunderstanding/inference；adjudicationMode=deterministic/reproducible_random/hybrid；item status=intact/damaged/destroyed/consumed/lost；knowledge operation=learn/believe/correct_belief；ending family=main/drift/observer/failure/death/timeout/exit。

{
  "package": {
    "schemaVersion": 1, "storyId": "EXAMPLE_STORY", "versionNumber": 1, "summary": "故事摘要",
    "coreFactGraph": {"facts": [{
      "factId": "FACT_EXAMPLE", "factKind": "world_rule",
      "statement": "单一事实", "subjectId": null, "predicate": "predicate", "objectId": null,
      "timeScope": {}, "locationId": null, "truthStatus": "true",
      "mutability": "immutable", "commitStatus": "committed", "knowledgeHolderIds": [],
      "playerVisibility": "hidden", "revealConditionIds": [],
      "dependencyFactIds": [], "conflictFactIds": [], "persistence": "permanent"
    }]},
    "entityResourceGraph": {
      "actors": [{
        "actorId": "PLAYER_1", "name": "人物名", "kind": "player", "publicBackground": "",
        "hiddenBackground": "", "outwardTraits": [], "goals": [], "currentPlan": "", "abilities": [],
        "weaknesses": [], "prohibitions": [], "moralLimits": [], "initialLocationId": "LOC_EXAMPLE",
        "scheduleIds": [], "knownFactIds": [], "unknownFactIds": [], "mistakenFactIds": [], "secretIds": [],
        "responseRules": [], "speechStyle": "", "initialStatus": "active",
        "initialPhysicalState": "正常"
      }],
      "locations": [{
        "locationId": "LOC_EXAMPLE", "name": "地点名", "regionId": null,
        "connections": [{"toLocationId":"LOC_EXAMPLE","travelSeconds":60,"entryConditionIds":[]}],
        "visibility": "", "audibility": "", "environment": "", "initialActorIds": [],
        "initialItemInstanceIds": [], "interactiveObjectIds": [], "hiddenAreaIds": [],
        "searchDifficulty": "ordinary", "traceRules": [], "timedChangeIds": []
      }],
      "items": [{
        "itemInstanceId": "ITEM_EXAMPLE", "itemTypeId": "ITEM_TYPE", "name": "物品名", "unique": true,
        "initialLocationId": null, "initialOwnerId": "PLAYER_1", "consumable": false, "useConditionIds": [],
        "useEffectIds": [], "damageable": false, "transferable": true, "hideable": true, "copyable": false,
        "evidence": false, "recognizedByActorIds": [], "destructionConsequenceIds": []
      }],
      "resources": [{"resourceId":"RESOURCE_EXAMPLE","name":"资源名","ownerId":"PLAYER_1","initialAmount":1,"minimum":0,"maximum":10,"unit":"份"}],
      "organizations": [{"organizationId":"ORG_EXAMPLE","name":"组织名","memberActorIds":[]}]
    },
    "knowledgeGraph": {"knowledge": [{
      "knowledgeId": "KNOWLEDGE_EXAMPLE", "kind": "truth",
      "objectiveStatement": "认知内容", "holderActorIds": [], "mistakenHolderActorIds": [],
      "hiddenByActorIds": [], "evidenceItemIds": [], "evidenceLocationIds": [], "acquireConditionIds": [],
      "canBeDestroyed": false, "affectedActorIds": [], "irreversibleOnceRevealed": true,
      "relatedEndingIds": [], "propagationRules": []
    }]},
    "actionTransitionGraph": {
      "adjudicationMode": "hybrid",
      "transitions": [{
        "transitionId": "TRANSITION_EXAMPLE", "actionKind": "search", "description": "行动转换说明",
        "precondition": {"op":"exists","path":"actors.PLAYER_1"}, "deterministic": true,
        "baseSuccessProbability": null,
        "probabilityFactors": [{"condition":{"op":"eq","path":"flags.prepared","value":true},"delta":0.1,"reason":"充分准备"}],
        "successEffectIds": [], "failureEffectIds": [], "timeCostSeconds": 30,
        "audibleToLocationIds": [], "visibleToLocationIds": [], "irreversible": false
      }],
      "effects": [{
        "effectId": "EFFECT_EXAMPLE", "description": "效果说明",
        "resourceChanges": [{"resourceId":"RESOURCE_EXAMPLE","delta":-1,"reason":"消耗"}],
        "itemChanges": [{"itemInstanceId":"ITEM_EXAMPLE","ownerId":"PLAYER_1","locationId":null,"status":"intact","reason":"变化原因"}],
        "actorChanges": [{"actorId":"PLAYER_1","status":"active","locationId":"LOC_EXAMPLE","physicalState":"正常","reason":"变化原因"}],
        "knowledgeChanges": [{"actorId":"PLAYER_1","knowledgeId":"KNOWLEDGE_EXAMPLE","operation":"learn","reason":"认知变化原因"}],
        "flagChanges": {"prepared": true}
      }]
    },
    "timelineGraph": {"initialWorldSecond": 0, "scheduledEvents": [{
      "scheduledEventId": "SCHEDULE_EXAMPLE", "name": "世界事件", "triggerAtWorldSecond": 3600,
      "triggerCondition": null, "effectIds": [], "canBeMissed": false, "keyNode": false,
      "playerVisible": false, "playerVisibleSummary": "仅在 playerVisible=true 时填写",
      "visibleToLocationIds": [], "audibleToLocationIds": []
    }]},
    "endingStateGraph": {
      "endings": [{
        "endingId": "ENDING_EXAMPLE", "name": "结局名", "family": "failure",
        "priority": 100, "requiredCondition": {"op":"eq","path":"flags.escaped","value":true},
        "blockingCondition": null, "lockEventIds": [], "unlockEventIds": [], "invalidateEventIds": [],
        "epilogueDimensions": []
      }],
      "fallbackEndingIds": ["ENDING_EXAMPLE"]
    },
    "narrativeStyle": {"voice":"叙事口吻","tense":"现在时","prohibitedTechniques":[]}
  },
  "diagnostics": [{"severity":"warning","code":"MISSING_DETAIL","message":"需要人工确认的内容"}]
}`;
