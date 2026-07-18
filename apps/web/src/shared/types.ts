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

export type AccountUser = PublicUser & {
  username: string;
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
  isOnline: boolean;
  isMutual: boolean;
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
};

export type ConversationItem = {
  id: string;
  otherUser: Pick<PublicUser, "id" | "nickname" | "avatar" | "equippedBadge"> & { isOnline: boolean };
  lastMessage: { content: string; type: "text" | "sticker" | "room_invite"; stickerId: string | null; stickerName?: string | null; roomInvite?: OnlineSoupRoomInvite | null; isMine: boolean; createdAt: string } | null;
  unreadCount: number;
  updatedAt: string;
};

export type PrivateMessageItem = {
  id: string;
  senderId: string;
  content: string;
  type: "text" | "sticker" | "room_invite";
  stickerId: string | null;
  stickerName?: string | null;
  roomInvite?: OnlineSoupRoomInvite | null;
  isMine: boolean;
  isRead: boolean;
  createdAt: string;
};

export type StickerAsset = {
  id: string;
  name: string;
  text: string;
  staticUrl: string;
  animatedUrl: string;
  width: number;
  height: number;
};

export type StickerSeries = {
  id: string;
  name: string;
  characterName: string;
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
    type: "text" | "sticker" | "room_invite";
    createdAt: string;
  } | null;
  createdAt: string;
  updatedAt: string;
};

export type CircleMember = PublicUser & {
  joinedAt: string;
  isOnline: boolean;
};

export type CircleMessage = {
  id: string;
  sequence: number;
  circleId: string;
  sender: (Pick<PublicUser, "id" | "nickname" | "avatar" | "equippedBadge"> & { isOnline: boolean }) | null;
  content: string;
  type: "text" | "sticker" | "room_invite";
  stickerId: string | null;
  stickerName?: string | null;
  roomInvite?: OnlineSoupRoomInvite | null;
  mentions: Array<{
    userId: string;
    nickname: string;
  }>;
  createdAt: string;
};

export type CircleDetail = Omit<CircleSummary, "isJoined" | "latestMessage" | "unreadMention">;

export type OnlineSoupRoomStatus = "preparing" | "playing" | "ended" | "closed";
export type OnlineSoupMemberRole = "host" | "player" | "spectator" | "admin";
export type OnlineSoupAnswer = "yes" | "no" | "both" | "unknown" | "irrelevant";

export type OnlineSoupLobbyRoom = {
  id: string;
  code: string;
  name: string;
  type: "public" | "password";
  status: OnlineSoupRoomStatus;
  host: { id: string; nickname: string };
  soupTitle: string | null;
  playerCount: number;
  hasPassword: boolean;
  createdAt: string;
};

export type OnlineSoupChoice = {
  id: string;
  title: string;
  type: string;
  author: string;
  summary: string;
  coverImage: string | null;
  source: "mine" | "library";
};

export type OnlineSoupMessage = {
  id: string;
  sequence: string;
  roundId: string | null;
  soupId: string | null;
  roundEnded: boolean;
  allBottomsPublished: boolean;
  senderId: string | null;
  senderName: string | null;
  senderAvatar: string | null;
  senderEquippedBadge: EquippedBadge | null;
  type: "discussion" | "question" | "host" | "sticker" | "clue" | "supplemental_surface" | "bottom" | "manual" | "system";
  content: string;
  stickerId: string | null;
  senderIsHost: boolean;
  contentIndex: number | null;
  questionNumber: number | null;
  answer: OnlineSoupAnswer | null;
  createdAt: string;
  updatedAt: string;
};

export type OnlineSoupSnapshot = {
  room: {
    id: string;
    code: string;
    name: string;
    type: "public" | "password";
    status: OnlineSoupRoomStatus;
    hostOnline: boolean;
    playerCount: number;
    currentRoundId: string | null;
    soup: {
      id: string;
      title: string;
      type: string;
      surface: string;
      visibleSupplementalSurfaces: Array<{ index: number; content: string }>;
      supplementalSurfaces?: string[];
      bottom?: string;
      supplementalBottoms?: string[];
      manual?: string | null;
      publishedSurfaceIndices?: number[];
      publishedBottomIndices?: number[];
    } | null;
    createdAt: string;
  };
  me: { role: OnlineSoupMemberRole; isHost: boolean };
  members: Array<{ id: string; nickname: string; role: OnlineSoupMemberRole; avatar: string | null; equippedBadge: EquippedBadge | null; joinedAt: string }>;
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
