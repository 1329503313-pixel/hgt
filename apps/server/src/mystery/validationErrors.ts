import { z, type ZodError, type ZodIssue } from "zod";

const FIELD_LABELS: Record<string, string> = {
  source: "故事素材", title: "标题", coverUrl: "封面地址", coverData: "封面图片", removeCover: "移除封面设置", tags: "标签",
  storyBackground: "故事背景", storyContent: "故事内容", characterDesign: "人物塑造", presetEndings: "预设结局", coreSettings: "核心设定",
  display: "故事基础信息", hook: "一句话钩子", genres: "类型", era: "时代", region: "地域", perspective: "叙事视角",
  targetDurationMinutes: "目标游玩时长", playMode: "游玩模式", contentRating: "内容分级", themes: "核心主题",
  allowedContent: "允许出现的内容", forbiddenContent: "禁止出现的内容",
  playerRole: "玩家角色", actorId: "人物编号", identity: "玩家身份", physicalProfile: "身体条件", socialStatus: "社会地位",
  skills: "已掌握技能", excludedAbilities: "不具备的能力", initialLocationId: "初始地点编号", initialGoals: "初始目标",
  initialKnowledgeIds: "初始知识编号", initialItemInstanceIds: "初始物品编号", initialResources: "初始资源",
  initialPhysicalState: "初始身体状态", publicIdentity: "公开身份", hiddenIdentity: "隐藏身份", mayLie: "是否允许说谎",
  mayTakeHighRiskActions: "是否允许高风险行动", worldRules: "世界法则", worldType: "世界类型", technologyLevel: "科技水平",
  supernaturalRules: "超自然规则", lawsAndNorms: "法律与社会规范", lifeAndDeathRules: "生死规则", medicalRules: "医疗规则",
  communicationRules: "通讯规则", transportRules: "交通规则", informationSpeedRules: "信息传播规则",
  allowsResurrection: "是否允许复活", allowsTimeTravel: "是否允许时间旅行", allowsPrecognition: "是否允许预知",
  allowsMindReading: "是否允许读心", absoluteImpossibilities: "绝对不可能发生的事情", authoringNotes: "创作备注",
  storyPackage: "故事结构包", schemaVersion: "结构版本", storyId: "谜局编号", versionNumber: "版本号", summary: "故事摘要",
  coreFactGraph: "核心事实图", facts: "事实", entityResourceGraph: "实体、地点和资源图", actors: "人物", locations: "地点",
  connections: "通行关系", toLocationId: "目标地点编号", travelSeconds: "移动时间", entryConditionIds: "进入条件编号",
  initialActorIds: "初始人物编号", interactiveObjectIds: "可交互对象编号", hiddenAreaIds: "隐藏区域编号", timedChangeIds: "定时变化编号",
  items: "物品", resources: "资源", organizations: "组织", knowledgeGraph: "知识与认知图", knowledge: "知识",
  actionTransitionGraph: "因果与行动转换图", adjudicationMode: "裁决方式", transitions: "行动转换", effects: "行动效果",
  timelineGraph: "时间线与世界时钟", initialWorldSecond: "初始世界时间", scheduledEvents: "排期世界事件",
  endingStateGraph: "结局状态图", endings: "结局", fallbackEndingIds: "兜底结局编号", narrativeStyle: "叙事风格",
  name: "名称", description: "描述", statement: "事实陈述", reason: "原因", status: "状态", locationId: "地点编号",
  ownerId: "所有者编号", itemInstanceId: "物品实例编号", resourceId: "资源编号", knowledgeId: "知识编号",
  transitionId: "行动转换编号", effectId: "行动效果编号", scheduledEventId: "排期事件编号", endingId: "结局编号",
  unit: "资源单位", path: "状态字段路径", value: "字段值", conditions: "条件", requiredCondition: "必要条件",
  blockingCondition: "阻断条件", voice: "叙事口吻", tense: "叙事时态", prohibitedTechniques: "禁止的叙事手法",
  factId: "事实编号", factKind: "事实类型", subjectId: "主体编号", predicate: "事实关系", objectId: "客体编号",
  timeScope: "时间范围", truthStatus: "真值状态", mutability: "可变性", commitStatus: "提交状态",
  knowledgeHolderIds: "知情人物编号", playerVisibility: "玩家可见性", revealConditionIds: "揭示条件编号",
  dependencyFactIds: "依赖事实编号", conflictFactIds: "冲突事实编号", persistence: "持久化范围",
  kind: "类型", publicBackground: "公开背景", hiddenBackground: "隐藏背景", outwardTraits: "外在性格",
  goals: "人物目标", currentPlan: "当前计划", abilities: "能力", weaknesses: "弱点", prohibitions: "禁止行为",
  moralLimits: "道德底线", scheduleIds: "日程事件编号", knownFactIds: "已知事实编号", unknownFactIds: "未知事实编号",
  mistakenFactIds: "错误认知编号", secretIds: "秘密编号", responseRules: "反应规则", speechStyle: "说话风格",
  initialStatus: "初始状态", regionId: "区域编号", visibility: "可见范围", audibility: "可听范围",
  environment: "环境", searchDifficulty: "搜索难度", traceRules: "痕迹规则", itemTypeId: "物品类型编号",
  unique: "是否唯一", initialOwnerId: "初始所有者编号", consumable: "是否可消耗", useConditionIds: "使用条件编号",
  useEffectIds: "使用效果编号", damageable: "是否可损坏", transferable: "是否可转移", hideable: "是否可隐藏",
  copyable: "是否可复制", evidence: "是否为证据", recognizedByActorIds: "可识别人物编号",
  destructionConsequenceIds: "销毁后果编号", initialAmount: "初始数量", minimum: "最小值", maximum: "最大值",
  organizationId: "组织编号", memberActorIds: "组织成员编号", objectiveStatement: "客观认知内容",
  holderActorIds: "持有人物编号", mistakenHolderActorIds: "错误认知人物编号", hiddenByActorIds: "隐瞒人物编号",
  evidenceItemIds: "证据物品编号", evidenceLocationIds: "证据地点编号", acquireConditionIds: "获取条件编号",
  canBeDestroyed: "是否可销毁", affectedActorIds: "受影响人物编号", irreversibleOnceRevealed: "揭示后是否不可逆",
  relatedEndingIds: "相关结局编号", propagationRules: "传播规则", op: "条件运算符", condition: "条件",
  actionKind: "行动类型", precondition: "前置条件", deterministic: "是否确定裁决", baseSuccessProbability: "基础成功概率",
  probabilityFactors: "概率因素", successEffectIds: "成功效果编号", failureEffectIds: "失败效果编号",
  timeCostSeconds: "耗时", audibleToLocationIds: "可听地点编号", visibleToLocationIds: "可见地点编号",
  irreversible: "是否不可逆", resourceChanges: "资源变化", itemChanges: "物品变化", actorChanges: "人物变化",
  knowledgeChanges: "认知变化", flagChanges: "世界标记变化", delta: "变化量", operation: "操作类型",
  triggerAtWorldSecond: "触发时间", triggerCondition: "触发条件", effectIds: "效果编号", canBeMissed: "是否可错过",
  keyNode: "是否关键节点", playerVisible: "是否对玩家可见", playerVisibleSummary: "玩家可见摘要",
  family: "结局家族", priority: "结局优先级", lockEventIds: "锁定事件编号", unlockEventIds: "解锁事件编号",
  invalidateEventIds: "失效事件编号", epilogueDimensions: "尾声维度",
};

function fieldName(path: Array<string | number>, fallback: string) {
  const parts: string[] = [];
  for (const segment of path) {
    if (typeof segment === "number") {
      if (parts.length) parts[parts.length - 1] += `第 ${segment + 1} 项`;
      else parts.push(`第 ${segment + 1} 项`);
      continue;
    }
    if (FIELD_LABELS[segment]) parts.push(FIELD_LABELS[segment]);
  }
  if (!parts.length) return fallback;
  const firstIndexedPart = parts.findIndex((part) => /第 \d+ 项/u.test(part));
  return (firstIndexedPart >= 0 ? parts.slice(firstIndexedPart) : parts.slice(-1)).join("的");
}

function hasChinese(message: string) {
  return /[\u3400-\u9fff]/u.test(message);
}

function dataTypeName(type: string) {
  const names: Record<string, string> = {
    string: "文本",
    number: "数字",
    nan: "有效数字",
    integer: "整数",
    float: "小数",
    boolean: "布尔值",
    date: "日期",
    bigint: "大整数",
    symbol: "符号",
    function: "函数",
    undefined: "缺失值",
    null: "空值",
    array: "数组",
    object: "对象",
    unknown: "未知内容",
    promise: "异步结果",
    void: "空内容",
    never: "不允许的内容",
    map: "映射表",
    set: "集合",
  };
  return names[type] ?? "正确格式的数据";
}

export function formatMysteryValidationIssue(issue: ZodIssue, fallback = "谜局数据") {
  const field = fieldName(issue.path, fallback);
  if (hasChinese(issue.message)) return `${field}：${issue.message}`;

  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      return issue.received === "undefined"
        ? `${field}为必填项`
        : `${field}必须填写为${dataTypeName(issue.expected)}，当前为${dataTypeName(issue.received)}`;
    case z.ZodIssueCode.too_big:
      if (issue.type === "string") return `${field}最多填写 ${issue.maximum} 个字符`;
      if (issue.type === "array") return `${field}最多包含 ${issue.maximum} 项`;
      return issue.inclusive ? `${field}不能大于 ${issue.maximum}` : `${field}必须小于 ${issue.maximum}`;
    case z.ZodIssueCode.too_small:
      if (issue.type === "string" && Number(issue.minimum) === 1) return `${field}不能为空`;
      if (issue.type === "string") return `${field}至少填写 ${issue.minimum} 个字符`;
      if (issue.type === "array") return `${field}至少需要 ${issue.minimum} 项`;
      return issue.inclusive ? `${field}不能小于 ${issue.minimum}` : `${field}必须大于 ${issue.minimum}`;
    case z.ZodIssueCode.invalid_enum_value:
    case z.ZodIssueCode.invalid_literal:
    case z.ZodIssueCode.invalid_union:
    case z.ZodIssueCode.invalid_union_discriminator:
      return `${field}的取值不在允许范围内`;
    case z.ZodIssueCode.invalid_string:
      if (issue.validation === "regex" && issue.path.some((segment) => typeof segment === "string" && /Ids?$/.test(segment))) {
        return `${field}只能使用英文字母、数字、冒号、下划线和短横线`;
      }
      return `${field}的格式不符合要求`;
    case z.ZodIssueCode.unrecognized_keys:
      return `${field}包含不支持的字段`;
    case z.ZodIssueCode.not_multiple_of:
      return `${field}必须是 ${issue.multipleOf} 的整数倍`;
    case z.ZodIssueCode.not_finite:
      return `${field}必须是有效数字`;
    default:
      return `${field}未通过校验，请检查填写内容`;
  }
}

export function formatMysteryValidationIssues(error: ZodError, limit = 20, fallback = "谜局数据") {
  return error.issues.slice(0, limit).map((issue) => formatMysteryValidationIssue(issue, fallback));
}

export function formatMysteryValidationError(error: ZodError, fallback = "谜局数据") {
  return formatMysteryValidationIssues(error, 1, fallback)[0] ?? `${fallback}不完整`;
}
