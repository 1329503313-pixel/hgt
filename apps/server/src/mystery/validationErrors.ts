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
  items: "物品", resources: "资源", organizations: "组织", knowledgeGraph: "知识与认知图", knowledge: "知识",
  actionTransitionGraph: "因果与行动转换图", adjudicationMode: "裁决方式", transitions: "行动转换", effects: "行动效果",
  timelineGraph: "时间线与世界时钟", initialWorldSecond: "初始世界时间", scheduledEvents: "排期世界事件",
  endingStateGraph: "结局状态图", endings: "结局", fallbackEndingIds: "兜底结局编号", narrativeStyle: "叙事风格",
  name: "名称", description: "描述", statement: "事实陈述", reason: "原因", status: "状态", locationId: "地点编号",
  ownerId: "所有者编号", itemInstanceId: "物品实例编号", resourceId: "资源编号", knowledgeId: "知识编号",
  transitionId: "行动转换编号", effectId: "行动效果编号", scheduledEventId: "排期事件编号", endingId: "结局编号",
  unit: "资源单位", path: "状态字段路径", value: "字段值", conditions: "条件", requiredCondition: "必要条件",
  blockingCondition: "阻断条件", voice: "叙事口吻", tense: "叙事时态", prohibitedTechniques: "禁止的叙事手法",
};

function fieldName(path: Array<string | number>, fallback: string) {
  let label = fallback;
  let indexedParent: string | null = null;
  for (const segment of path) {
    if (typeof segment === "number") {
      label += `第 ${segment + 1} 项`;
      indexedParent = label;
      continue;
    }
    if (FIELD_LABELS[segment]) label = indexedParent ? `${indexedParent}的${FIELD_LABELS[segment]}` : FIELD_LABELS[segment];
  }
  return label;
}

function hasChinese(message: string) {
  return /[\u3400-\u9fff]/u.test(message);
}

export function formatMysteryValidationIssue(issue: ZodIssue, fallback = "谜局数据") {
  const field = fieldName(issue.path, fallback);
  if (hasChinese(issue.message)) return `${field}：${issue.message}`;

  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      return issue.received === "undefined" ? `${field}为必填项` : `${field}的格式不正确`;
    case z.ZodIssueCode.too_big:
      if (issue.type === "string") return `${field}最多填写 ${issue.maximum} 个字符`;
      if (issue.type === "array") return `${field}最多包含 ${issue.maximum} 项`;
      return `${field}不能大于 ${issue.maximum}`;
    case z.ZodIssueCode.too_small:
      if (issue.type === "string" && Number(issue.minimum) === 1) return `${field}不能为空`;
      if (issue.type === "array") return `${field}至少需要 ${issue.minimum} 项`;
      return `${field}不能小于 ${issue.minimum}`;
    case z.ZodIssueCode.invalid_enum_value:
    case z.ZodIssueCode.invalid_literal:
    case z.ZodIssueCode.invalid_union:
    case z.ZodIssueCode.invalid_union_discriminator:
      return `${field}的取值不在允许范围内`;
    case z.ZodIssueCode.invalid_string:
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
