export type UserRole = "admin" | "user";
export type RequestStatus = "pending" | "approved" | "rejected";
export type BottomPublicFilter = "all" | "surface" | "bottom";
export type RatingFilter = "all" | "2" | "3" | "4";

export type PublicUser = {
  id: string;
  username: string;
  nickname: string;
  avatar: string | null;
  role: UserRole;
  createdAt: string;
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
  isSurfacePublic: boolean;
  isBottomPublic: boolean;
  viewCount: number;
  createdAt: string;
  evaluationCount: number;
  averageTotal: number | null;
  radar: RadarStats;
};

export type Evaluation = {
  id: string;
  soupId: string;
  total: number;
  reviewer: string;
  reviewerId: string;
  writing: number | null;
  logic: number | null;
  share: number | null;
  mechanism: number | null;
  twist: number | null;
  depth: number | null;
  content: string | null;
  createdAt: string;
};

export type SoupDetail = SoupSummary & {
  surface: string;
  supplementalSurfaces: string[];
  bottom: string | null;
  supplementalBottoms: string[] | null;
  manual: string | null;
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
  isRead: boolean;
  createdAt: string;
};

export type ViewRequestItem = {
  id: string;
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
