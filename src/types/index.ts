import { Request } from 'express';

export interface AuthPayload {
  userId: string;
  email: string;
}

export interface AuthRequest extends Request {
  user?: AuthPayload;
}

export interface PaginationQuery {
  page?: number;
  limit?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ─── Database row types ───

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  avatar_url: string | null;
  status: string;
  language: string;
  created_at: Date;
  updated_at: Date;
}

export interface UserSessionRow {
  id: string;
  user_id: string;
  refresh_token: string;
  ip_address: string;
  user_agent: string;
  expires_at: Date;
  created_at: Date;
}

export interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  owner_user_id: string;
  created_at: Date;
  updated_at: Date;
}

export interface OrganizationMemberRow {
  id: string;
  organization_id: string;
  user_id: string;
  role_id: string;
  invited_by_member_id: string | null;
  is_subscription_manager: boolean;
  status: string;
  joined_at: Date;
  created_at: Date;
}

export interface OrganizationInvitationRow {
  id: string;
  organization_id: string;
  email: string;
  role_id: string;
  invited_by_member_id: string;
  token: string;
  status: string;
  expires_at: Date;
  created_at: Date;
}

export interface EventRow {
  id: string;
  organization_id: string;
  created_by_member_id: string;
  title: string;
  description: string;
  event_mode: string;
  visibility: string;
  max_participants: number;
  start_time: Date;
  end_time: Date;
  expires_at: Date;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface ParticipantRow {
  id: string;
  event_id: string;
  organization_member_id: string | null;
  guest_name: string | null;
  guest_avatar: string | null;
  participant_type: string;
  invited_by_member_id: string | null;
  joined_at: Date;
  left_at: Date | null;
  created_at: Date;
}

export interface GameSessionRow {
  id: string;
  event_id: string;
  game_type_id: string;
  status: string;
  current_round: number;
  game_duration_minutes: number;
  expires_at: Date;
  metadata: any;
  started_at: Date;
  ended_at: Date | null;
}

export interface GameRoundRow {
  id: string;
  game_session_id: string;
  round_number: number;
  round_duration_seconds: number;
  status: string;
  metadata: any;
  started_at: Date;
  ended_at: Date | null;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  data: any;
  read_at: Date | null;
  created_at: Date;
}
