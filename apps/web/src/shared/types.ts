export type UserRole = "admin" | "user";
export type RequestStatus = "pending" | "approved" | "rejected";
export type BottomPublicFilter = "all" | "surface" | "bottom";
export type RatingFilter = "all" | "2" | "3" | "4";
export type SoupReviewStatus = "approved" | "pending" | "rejected";

export type EquippedBadge = {
  key: string;
  iconUrl: string;
  name: string;
  tier: "normal" | "rare" | "epic" | "legend";
};

export type PublicUser = {
  id: string;
  username: string;
  nickname: string;
  avatar: string | null;
  role: UserRole;
  createdAt: string;
  equippedBadge: EquippedBadge | null;
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
  summary: string;
  coverImage: string | null;
  isOriginal: boolean;
  creatorId: string;
  creatorName: string;
  creatorAvatar: string | null;
  creatorEquippedBadge: EquippedBadge | null;
  isSurfacePublic: boolean;
  isBottomPublic: boolean;
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
  reviewerEquippedBadge: EquippedBadge | null;
  writing: number | null;
  logic: number | null;
  share: number | null;
  mechanism: number | null;
  twist: number | null;
  depth: number | null;
  content: string | null;
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
  aiPrompt: string | null;
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

export type SocialProfile = PublicUser & {
  receivedLikeCount: number;
  followingCount: number;
  followerCount: number;
  isFollowing: boolean;
  isSelf: boolean;
};

export type SocialUser = PublicUser & {
  isFollowing: boolean;
  isSelf: boolean;
};

export type ConversationItem = {
  id: string;
  otherUser: Pick<PublicUser, "id" | "username" | "nickname" | "avatar">;
  lastMessage: { content: string; isMine: boolean; createdAt: string } | null;
  unreadCount: number;
  updatedAt: string;
};

export type PrivateMessageItem = {
  id: string;
  senderId: string;
  content: string;
  isMine: boolean;
  isRead: boolean;
  createdAt: string;
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
