export type UserRole = "super_admin" | "backoffice_admin" | "vip" | "user";
export type VipLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type VipGrowthEvent = { id: string; type: string; amount: number; date: string | null; remark: string; createdAt: string };
export type VipOverview = {
  growthValue: number;
  level: VipLevel;
  active: boolean;
  vipExpiresAt: string | null;
  vipExpired: boolean;
  multiplier: number;
  previousThreshold: number;
  nextThreshold: number | null;
  progressPercent: number;
  benefits: Record<string, number | null>;
  activePlan: Record<string, number | null>;
  events: VipGrowthEvent[];
};
export type RequestStatus = "pending" | "approved" | "rejected";
export type BottomPublicFilter = "all" | "surface" | "bottom";
export type RatingFilter = "all" | "2" | "3" | "4";
export type SoupReviewStatus = "approved" | "pending" | "rejected";
export type SoupDifficulty = "简单" | "普通" | "困难" | "地狱";

export type EquippedBadge = {
  key: string;
  iconUrl: string;
  name: string;
  tier: "normal" | "rare" | "epic" | "legend";
};

export type PublicUser = {
  id: string;
  nickname: string;
  bio: string;
  avatar: string | null;
  role: UserRole;
  createdAt: string;
  level: number;
  equippedBadge: EquippedBadge | null;
  vipGrowthValue: number;
  vipLevel: VipLevel;
  vipActive: boolean;
};

export type RadarStats = {
  writing: number | null;
  logic: number | null;
  share: number | null;
  mechanism: number | null;
  twist: number | null;
  depth: number | null;
};

export type SoupSummary = {
  id: string;
  title: string;
  author: string;
  type: string;
  difficulty: SoupDifficulty;
  summary: string;
  coverImage: string | null;
  isOriginal: boolean;
  creatorId: string;
  creatorName: string;
  creatorAvatar: string | null;
  creatorLevel: number;
  creatorVipGrowthValue: number;
  creatorVipLevel: VipLevel;
  creatorVipActive: boolean;
  creatorEquippedBadge: EquippedBadge | null;
  isSurfacePublic: boolean;
  isBottomPublic: boolean;
  enableAiGame: boolean;
  viewCount: number;
  likeCount: number;
  favoriteCount: number;
  isLiked: boolean;
  isFavorited: boolean;
  createdAt: string;
  evaluationCount: number;
  averageTotal: number | null;
  heatValue: number;
  reviewStatus: SoupReviewStatus;
  reviewReason: string | null;
  reviewVersion: number;
  radar: RadarStats;
};

export type Evaluation = {
  id: string;
  soupId: string;
  total: number;
  reviewer: string;
  reviewerId: string;
  reviewerAvatar: string | null;
  reviewerLevel: number;
  reviewerVipGrowthValue: number;
  reviewerVipLevel: VipLevel;
  reviewerVipActive: boolean;
  reviewerEquippedBadge: EquippedBadge | null;
  isCreatorEvaluation: boolean;
  countsTowardScore: boolean;
  writing: number | null;
  logic: number | null;
  share: number | null;
  mechanism: number | null;
  twist: number | null;
  depth: number | null;
  content: string | null;
  isContentHidden: boolean;
  createdAt: string;
};

export type KeyFact = {
  id: number;
  content: string;
  weight: number;
};

export type SoupDetail = SoupSummary & {
  surface: string;
  supplementalSurfaces: string[];
  bottom: string | null;
  supplementalBottoms: string[] | null;
  manual: string | null;
  enableAiGame: boolean;
  canConfigureAiGame: boolean;
  keyFacts: KeyFact[] | null;
  keyFactsCustomized: boolean;
  canViewFull: boolean;
  canEdit: boolean;
  isFavorited: boolean;
  isLiked: boolean;
  pendingRequestId: string | null;
  evaluations: Evaluation[];
};

export type NotificationItem = {
  id: string;
  type: string;
  title: string;
  content: string;
  relatedId: string | null;
  link: string | null;
  isRead: boolean;
  createdAt: string;
};

export type ViewRequestItem = {
  id: string;
  applicationType: "申请汤底";
  soupId: string;
  soupTitle: string;
  requesterId: string;
  requesterName: string;
  ownerId: string;
  status: RequestStatus;
  createdAt: string;
  handledAt: string | null;
  handledBy: string | null;
};

export type RankingRewardSettlementDetail = {
  id: string;
  periodType: "weekly" | "monthly";
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  completedAt: string;
  grants: Array<{
    board: "achievement" | "level" | "collection" | "charm" | "generosity" | "draws";
    boardLabel: string;
    rank: number;
    metricValue: number;
    reward:
      | { type: "currency"; experience: number; shell: number }
      | { type: "gift"; giftName: string; quantity: number; creditedQuantity: number; overflowQuantity: number; overflowShell: number };
  }>;
};

export type AccountUser = PublicUser & {
  username: string;
};

export type SocialProfile = PublicUser & {
  charmValue: number;
  generosityValue: number;
  receivedLikeCount: number;
  followingCount: number;
  followerCount: number;
  isFollowing: boolean;
  isSelf: boolean;
  profileBackgroundUrl: string | null;
  profileBackgroundSourceUrl: string | null;
  profileBackgroundMotionMp4Url: string | null;
  profileBackgroundMotionWebmUrl: string | null;
  profileBackgroundMotionPosterUrl: string | null;
  profileBackgroundCrop: { x: number; y: number; zoom: number };
};

export type SocialUser = PublicUser & {
  isFollowing: boolean;
  isSelf: boolean;
  isOnline: boolean;
  isMutual: boolean;
};

export type ShellTaskType =
  | "daily_login"
  | "publish_soup"
  | "like_soup"
  | "favorite_soup"
  | "publish_evaluation"
  | "speak_circle"
  | "join_online_soup"
  | "host_online_soup"
  | "receive_soup_like"
  | "receive_soup_favorite"
  | "receive_soup_evaluation"
  | "soup_ai_played"
  | "soup_online_completed";

export type ShellTask = {
  type: ShellTaskType;
  name: string;
  description: string;
  reward: number;
  dailyLimit: number;
  progress: number;
  completed: boolean;
  actualReward: number;
  experienceReward: number;
  actualExperience: number;
  dailyMaximum: number;
  giftReward?: {
    name: "汤汤抱枕" | "幸运贝壳";
    quantity: number;
  };
};

export type BeginnerTaskType =
  | "upload_avatar"
  | "complete_ten_draws"
  | "equip_badge"
  | "bind_email"
  | "change_profile_background"
  | "invite_verified_email"
  | "invite_shell_milestone";

export type BeginnerTask = {
  type: BeginnerTaskType;
  name: string;
  description: string;
  reward: number;
  progress: number;
  target: number;
  completed: boolean;
  actualReward: number;
  experienceReward: number;
  actualExperience: number;
  completedAt: string | null;
  repeatable?: boolean;
  completedCount?: number;
};

export type ShellTaskCenter = {
  balance: number;
  taskDate: string;
  earnedToday: number;
  earnedExperienceToday: number;
  dailyLimit: number;
  theoreticalMaximum: number;
  levelProgress: import("./levelSystem").LevelProgress;
  tasks: ShellTask[];
  beginnerTasks: BeginnerTask[];
};

export type ShellTransaction = {
  id: string;
  type: string;
  typeLabel: string;
  amount: number;
  experienceAmount: number;
  balanceAfter: number;
  relatedType: string | null;
  relatedId: string | null;
  remark: string | null;
  operatorId: string | null;
  createdAt: string;
};

export type ShellTransactionsResponse = {
  transactions: ShellTransaction[];
  total: number;
  hasMore: boolean;
};

export type OnlineSoupRoomInvite = {
  roomId: string;
  inviteToken: string;
  roomName: string;
  roomCode: string;
  soupTitle: string | null;
  status: OnlineSoupRoomStatus;
  playerCount: number;
  playerCapacity: number;
  participantCount?: number;
  participantCapacity?: number;
};

export type SoupShare = Pick<SoupSummary, "id" | "title" | "author" | "type" | "difficulty" | "summary" | "coverImage" | "heatValue" | "averageTotal" | "likeCount" | "favoriteCount">;

export type GiftMessage = {
  giftSendId: string;
  giftId: string;
  giftName: string;
  iconUrl: string;
  quantity: number;
  sender: { id: string; nickname: string };
  recipient: { id: string; nickname: string };
  shellReward: number;
  charmReward: number;
  createdAt: string;
};

export type GiftCatalogItem = {
  id: string;
  name: string;
  description: string;
  iconUrl: string;
  costAmount: number;
  rewardShell: number;
  rewardCharm: number;
  inventoryQuantity: number;
};

export type ConversationItem = {
  id: string;
  otherUser: Pick<PublicUser, "id" | "nickname" | "avatar" | "level" | "equippedBadge" | "vipGrowthValue" | "vipLevel" | "vipActive"> & { isOnline: boolean };
  lastMessage: { content: string; type: "text" | "sticker" | "room_invite" | "soup_share" | "gift"; stickerId: string | null; stickerName?: string | null; roomInvite?: OnlineSoupRoomInvite | null; soupShare?: SoupShare | null; gift?: GiftMessage | null; isMine: boolean; createdAt: string; recalledAt: string | null } | null;
  unreadCount: number;
  updatedAt: string;
};

export type PrivateMessageItem = {
  id: string;
  senderId: string;
  content: string;
  type: "text" | "sticker" | "room_invite" | "soup_share" | "gift";
  stickerId: string | null;
  stickerName?: string | null;
  roomInvite?: OnlineSoupRoomInvite | null;
  soupShare?: SoupShare | null;
  gift?: GiftMessage | null;
  isMine: boolean;
  isRead: boolean;
  createdAt: string;
  recalledAt: string | null;
};

export type StickerAsset = {
  id: string;
  name: string;
  text: string;
  description: string;
  staticUrl: string;
  animatedUrl: string;
  width: number;
  height: number;
  weight: number;
  price: number;
  owned: boolean;
};

export type StickerSeries = {
  id: string;
  name: string;
  description: string;
  weight: number;
  stickers: StickerAsset[];
};

export type CircleSummary = {
  id: string;
  name: string;
  avatar: string;
  isJoined: boolean;
  memberCount: number;
  onlineCount: number;
  unreadCount: number;
  unreadMention: {
    id: string;
    content: string;
  } | null;
  latestMessage: {
    id: string;
    senderName: string;
    content: string;
    type: "text" | "sticker" | "room_invite" | "soup_share" | "gift";
    createdAt: string;
  } | null;
  createdAt: string;
  updatedAt: string;
};

export type CircleMember = PublicUser & {
  joinedAt: string;
  isOnline: boolean;
};

export type CircleMessageReply = {
  id: string;
  sequence: number;
  sender: Pick<PublicUser, "id" | "nickname"> | null;
  content: string;
  type: "text" | "sticker" | "room_invite" | "soup_share" | "gift";
  stickerId: string | null;
  stickerName?: string | null;
  gift?: GiftMessage | null;
  recalledAt: string | null;
};

export type CircleMessage = {
  id: string;
  sequence: number;
  circleId: string;
  sender: (Pick<PublicUser, "id" | "nickname" | "avatar" | "level" | "equippedBadge" | "vipGrowthValue" | "vipLevel" | "vipActive"> & { isOnline: boolean }) | null;
  content: string;
  type: "text" | "sticker" | "room_invite" | "soup_share" | "gift";
  stickerId: string | null;
  stickerName?: string | null;
  roomInvite?: OnlineSoupRoomInvite | null;
  soupShare?: SoupShare | null;
  gift?: GiftMessage | null;
  mentions: Array<{
    userId: string;
    nickname: string;
  }>;
  replyTo: CircleMessageReply | null;
  createdAt: string;
  recalledAt: string | null;
};

export type CircleDetail = Omit<CircleSummary, "isJoined" | "latestMessage" | "unreadMention">;

export type OnlineSoupRoomStatus = "preparing" | "playing" | "ended" | "closed";
export type OnlineSoupHostMode = "human" | "ai";
export type OnlineSoupMemberRole = "host" | "player" | "spectator" | "admin";
export type OnlineSoupAnswer = "yes" | "no" | "both" | "unknown" | "irrelevant";

export type OnlineSoupAiHonors = {
  version: 1;
  mvp: {
    userId: string;
    nickname: string;
    avatar: string | null;
    progressContribution: number;
  };
  bestQuestion: {
    messageId: string;
    questionNumber: number;
    userId: string;
    nickname: string;
    avatar: string | null;
    question: string;
    answer: OnlineSoupAnswer;
    progressDelta: number;
  };
};

export type OnlineSoupLobbyRoom = {
  id: string;
  code: string;
  name: string;
  type: "public" | "password";
  status: OnlineSoupRoomStatus;
  hostMode: OnlineSoupHostMode;
  contentType: "soup" | "mystery";
  host: { id: string; nickname: string };
  soupTitle: string | null;
  mysteryTitle: string | null;
  playerCount: number;
  playerCapacity: number;
  participantCount: number;
  participantCapacity: number;
  hasPassword: boolean;
  viewerRole: Exclude<OnlineSoupMemberRole, "admin"> | null;
  createdAt: string;
};

export type OnlineSoupChoice = {
  id: string;
  title: string;
  type: string;
  author: string;
  summary: string;
  enableAiGame: boolean;
  coverImage: string | null;
  source: "mine" | "library";
};

export type OnlineSoupMessage = {
  id: string;
  sequence: string;
  roundId: string | null;
  mysteryRunId: string | null;
  soupId: string | null;
  roundEnded: boolean;
  allBottomsPublished: boolean;
  senderId: string | null;
  senderName: string | null;
  senderAvatar: string | null;
  senderVipGrowthValue: number;
  senderVipLevel: VipLevel;
  senderVipActive: boolean;
  senderEquippedBadge: EquippedBadge | null;
  type: "discussion" | "question" | "host" | "sticker" | "gift" | "clue" | "supplemental_surface" | "bottom" | "manual" | "system" | "ai_advice" | "ai_honor" | "mystery_narrative";
  content: string;
  aiHonors: OnlineSoupAiHonors | null;
  gift?: GiftMessage | null;
  stickerId: string | null;
  senderIsHost: boolean;
  contentIndex: number | null;
  questionNumber: number | null;
  answer: OnlineSoupAnswer | null;
  isBestQuestion: boolean;
  aiPreliminaryAnswer: OnlineSoupAnswer | null;
  aiStatus: "none" | "pending" | "answering" | "scoring" | "completed" | "failed" | "cancelled";
  aiError: string | null;
  aiProgressDelta: number | null;
  aiProgressAfter: number | null;
  aiFeedback: string | null;
  aiQueuePosition: number | null;
  targetMessageId: string | null;
  mentions: Array<{ userId: string; nickname: string }>;
  replyTo: {
    id: string;
    sequence: string;
    senderId: string | null;
    senderName: string | null;
    type: "discussion" | "question" | "host" | "sticker";
    content: string;
    stickerId: string | null;
    recalledAt: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
  recalledAt: string | null;
};

export type OnlineSoupSnapshot = {
  room: {
    id: string;
    code: string;
    name: string;
    type: "public" | "password";
    status: OnlineSoupRoomStatus;
    hostMode: OnlineSoupHostMode;
    contentType: "soup" | "mystery";
    aiProgress: number | null;
    finishVote: {
      id: string;
      status: "open" | "passed" | "auto_completed" | "cancelled";
      eligibleCount: number;
      viewBottomCount: number;
      continueCount: number;
      requiredViewBottomCount: number;
      myChoice: "view_bottom" | "continue" | null;
      canVote: boolean;
      openedAt: string | null;
    } | null;
    hostOnline: boolean;
    hostOfflineDeadline: string | null;
    playerCount: number;
    playerCapacity: number;
    participantCapacity: number;
    currentRoundId: string | null;
    bestQuestionMessageId: string | null;
    soup: {
      id: string;
      title: string;
      type: string;
      enableAiGame: boolean;
      surface: string;
      visibleSupplementalSurfaces: Array<{ index: number; content: string }>;
      supplementalSurfaces?: string[];
      bottom?: string;
      supplementalBottoms?: string[];
      manual?: string | null;
      publishedSurfaceIndices?: number[];
      publishedBottomIndices?: number[];
    } | null;
    mystery: {
      id: string;
      title: string;
      background: string;
      runId: string | null;
      runStatus: "active" | "completed" | "superseded" | "abandoned" | null;
      gameEnded: boolean;
    } | null;
    createdAt: string;
  };
  me: { role: OnlineSoupMemberRole; isHost: boolean };
  members: Array<{ id: string; nickname: string; level: number; role: OnlineSoupMemberRole; avatar: string | null; equippedBadge: EquippedBadge | null; vipGrowthValue: number; vipLevel: VipLevel; vipActive: boolean; joinedAt: string }>;
  messages: OnlineSoupMessage[];
  messagesHasMore: boolean;
  messagesNextCursor: string | null;
};

export type ExcellentAuthorApplicationStatus = {
  id: string;
  status: RequestStatus;
  createdAt: string;
  handledAt: string | null;
};

export type ExcellentAuthorApplicationItem = {
  id: string;
  applicationType: "申请认证优秀作者";
  applicantId: string;
  applicantName: string;
  primarySoupId: string | null;
  primarySoupTitle: string;
  heatValue: number;
  averageTotal: number | null;
  status: RequestStatus;
  createdAt: string;
  handledAt: string | null;
  handledBy: string | null;
};

export type ExcellentAuthorApplicationDetail = {
  id: string;
  applicationType: "申请认证优秀作者";
  applicantId: string;
  applicantName: string;
  status: RequestStatus;
  createdAt: string;
  handledAt: string | null;
  handledBy: string | null;
  primarySoup: SoupSummary | null;
  qualificationSoups: SoupSummary[];
};
