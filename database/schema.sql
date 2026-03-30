CREATE SCHEMA "public";
CREATE TABLE "_migrations" (
	"version" integer PRIMARY KEY,
	"name" varchar(255) NOT NULL,
	"applied_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "activity_feedbacks" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"event_id" uuid NOT NULL,
	"game_session_id" uuid,
	"game_type_key" varchar(50) NOT NULL,
	"participant_id" uuid NOT NULL,
	"reporter_name" varchar(200) NOT NULL,
	"reporter_avatar_url" text,
	"rating" smallint NOT NULL,
	"category" varchar(50),
	"comment" text NOT NULL,
	"source" varchar(50) DEFAULT 'end_clicked' NOT NULL,
	"ip_address" varchar(45),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "activity_feedbacks_rating_check" CHECK (((rating >= 1) AND (rating <= 5)))
);
CREATE TABLE "activity_posts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"event_id" uuid NOT NULL,
	"author_participant_id" uuid NOT NULL,
	"content" text NOT NULL,
	"parent_post_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"category" varchar(50) DEFAULT 'general',
	"tags" text[]
);
CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"user_id" uuid,
	"event_name" varchar(100) NOT NULL,
	"properties" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "analytics_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(255) NOT NULL,
	"report_type" varchar(50) NOT NULL,
	"generated_by" uuid NOT NULL,
	"date_from" date,
	"date_to" date,
	"data" jsonb,
	"format" varchar(20) DEFAULT 'json',
	"is_scheduled" boolean DEFAULT false,
	"schedule_frequency" varchar(50),
	"is_public" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"expires_at" timestamp
);
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"organization_id" uuid,
	"user_id" uuid,
	"event_id" uuid,
	"game_session_id" uuid,
	"participant_id" uuid,
	"action" varchar(100) NOT NULL,
	"details" text,
	"ip_address" varchar(45),
	"status" varchar(50),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "batch_assignments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"game_session_id" uuid NOT NULL UNIQUE,
	"batch_number" integer NOT NULL UNIQUE,
	"participant_id" uuid NOT NULL UNIQUE,
	"presenter_index" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "batch_assignments_game_session_id_batch_number_participant__key" UNIQUE("game_session_id","batch_number","participant_id")
);
CREATE TABLE "bug_report_attachments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"bug_report_id" uuid NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"file_size" integer NOT NULL,
	"file_type" varchar(100) NOT NULL,
	"file_url" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "bug_report_history" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"bug_report_id" uuid NOT NULL,
	"changed_by_user_id" uuid,
	"field_name" varchar(100),
	"old_value" text,
	"new_value" text,
	"change_type" varchar(20) DEFAULT 'update' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "bug_reports" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"user_id" uuid NOT NULL,
	"title" varchar(300) NOT NULL,
	"description" text NOT NULL,
	"type" varchar(50) DEFAULT 'bug_report' NOT NULL,
	"priority" varchar(20) DEFAULT 'medium' NOT NULL,
	"status" varchar(50) DEFAULT 'open' NOT NULL,
	"assigned_to_user_id" uuid,
	"resolution_notes" text,
	"resolved_at" timestamp,
	"closed_at" timestamp,
	"ip_address" varchar(45),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "coffee_groups" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"game_session_id" uuid NOT NULL UNIQUE,
	"group_number" integer NOT NULL UNIQUE,
	"group_id" varchar(50) NOT NULL UNIQUE,
	"topic" text,
	"started_chat_at" timestamp,
	"chat_ends_at" timestamp,
	"status" varchar(20) DEFAULT 'active',
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "coffee_groups_game_session_id_group_id_key" UNIQUE("game_session_id","group_id"),
	CONSTRAINT "coffee_groups_game_session_id_group_number_key" UNIQUE("game_session_id","group_number")
);
CREATE TABLE "coffee_roulette_config" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"event_id" uuid NOT NULL CONSTRAINT "coffee_roulette_config_event_id_key" UNIQUE,
	"duration_minutes" integer DEFAULT 30 NOT NULL,
	"max_prompts" integer DEFAULT 6 NOT NULL,
	"topic_selection_strategy" varchar(50) DEFAULT 'random' NOT NULL,
	"question_selection_strategy" varchar(50) DEFAULT 'random' NOT NULL,
	"allow_general_questions" boolean DEFAULT true NOT NULL,
	"shuffle_on_repeat" boolean DEFAULT true NOT NULL,
	"created_by_member_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "coffee_roulette_config_audit" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"config_id" uuid NOT NULL,
	"changed_by_member_id" uuid,
	"action" varchar(50) NOT NULL,
	"entity_type" varchar(100) NOT NULL,
	"entity_id" uuid,
	"old_values" jsonb,
	"new_values" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "coffee_roulette_pair_context" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"event_id" uuid NOT NULL,
	"participant1_id" uuid NOT NULL,
	"participant2_id" uuid NOT NULL,
	"session_start_time" timestamp DEFAULT now() NOT NULL,
	"session_end_time" timestamp,
	"duration_seconds" integer,
	"topic_id" uuid,
	"questions_used" uuid[] DEFAULT '{}',
	"questions_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "coffee_roulette_questions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"config_id" uuid NOT NULL,
	"text" text NOT NULL,
	"category" varchar(100),
	"difficulty" varchar(50) DEFAULT 'easy',
	"question_type" varchar(50) DEFAULT 'general' NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_member_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "coffee_roulette_topic_questions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"topic_id" uuid NOT NULL UNIQUE,
	"question_id" uuid NOT NULL UNIQUE,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "coffee_roulette_topic_questions_topic_id_question_id_key" UNIQUE("topic_id","question_id")
);
CREATE TABLE "coffee_roulette_topics" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"config_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"icon" varchar(50),
	"weight" integer DEFAULT 1 NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_member_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "contact_submissions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"name" varchar(100) NOT NULL,
	"email" varchar(255) NOT NULL,
	"subject" varchar(200) DEFAULT '',
	"message" text NOT NULL,
	"status" varchar(20) DEFAULT 'new' NOT NULL,
	"ip_address" varchar(45),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "content_moderation_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"content_id" uuid NOT NULL,
	"status" varchar(50) DEFAULT 'pending',
	"reason_for_flag" text,
	"flagged_by" uuid,
	"moderated_by" uuid,
	"moderation_notes" text,
	"flagged_at" timestamp DEFAULT now(),
	"moderated_at" timestamp
);
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"organization_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "early_access_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"first_name" varchar(100) NOT NULL,
	"last_name" varchar(100) NOT NULL,
	"email" varchar(255) NOT NULL,
	"company_name" varchar(255),
	"ip_address" varchar(45),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"provisioned_user_id" uuid,
	"account_provisioned_at" timestamp,
	"credentials_email_sent_at" timestamp,
	"last_email_error" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "email_verifications" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"user_id" uuid NOT NULL,
	"token" varchar(255) NOT NULL CONSTRAINT "email_verifications_token_key" UNIQUE,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"otp_code" varchar(6)
);
CREATE TABLE "event_invitations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"event_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"invited_by_member_id" uuid,
	"token" varchar(255) NOT NULL CONSTRAINT "event_invitations_token_key" UNIQUE,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "event_messages" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"event_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"message" text NOT NULL,
	"message_type" varchar(20) DEFAULT 'text',
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "event_profiles" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"event_id" uuid NOT NULL UNIQUE,
	"participant_id" uuid NOT NULL UNIQUE,
	"display_name" varchar(100) NOT NULL,
	"avatar_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "event_profiles_event_id_participant_id_key" UNIQUE("event_id","participant_id")
);
CREATE TABLE "event_settings" (
	"event_id" uuid PRIMARY KEY,
	"allow_guests" boolean DEFAULT true,
	"allow_chat" boolean DEFAULT true,
	"auto_start_games" boolean DEFAULT false,
	"max_rounds" integer DEFAULT 5,
	"allow_participant_game_control" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"default_session_duration_minutes" integer DEFAULT 30 NOT NULL,
	"two_truths_submit_seconds" integer DEFAULT 30 NOT NULL,
	"two_truths_vote_seconds" integer DEFAULT 20 NOT NULL,
	"coffee_chat_duration_minutes" integer DEFAULT 30 NOT NULL,
	"strategic_discussion_duration_minutes" integer DEFAULT 45 NOT NULL,
	"game_id" varchar(50) DEFAULT NULL
);
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"organization_id" uuid NOT NULL,
	"created_by_member_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"event_mode" varchar(20) DEFAULT 'sync',
	"visibility" varchar(20) DEFAULT 'private',
	"max_participants" integer DEFAULT 50,
	"start_time" timestamp,
	"end_time" timestamp,
	"expires_at" timestamp,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"pinned_message_id" uuid
);
CREATE TABLE "feature_flag_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"flag_id" uuid NOT NULL,
	"user_id" uuid,
	"organization_id" uuid,
	"assigned_variant" varchar(100),
	"evaluated_at" timestamp DEFAULT now()
);
CREATE TABLE "feature_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"key" varchar(255) NOT NULL CONSTRAINT "feature_flags_key_key" UNIQUE,
	"name" varchar(255) NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT false,
	"rollout_percentage" integer DEFAULT 0,
	"is_multivariant" boolean DEFAULT false,
	"variants" jsonb,
	"targeting_rules" jsonb,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"updated_by" uuid,
	"deleted_at" timestamp,
	CONSTRAINT "feature_flags_rollout_percentage_check" CHECK (((rollout_percentage >= 0) AND (rollout_percentage <= 100)))
);
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"owner_user_id" uuid NOT NULL,
	"url" text NOT NULL,
	"file_type" varchar(100),
	"size" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"original_name" varchar(255)
);
CREATE TABLE "game_actions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"game_session_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"action_type" varchar(50) NOT NULL,
	"payload" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "game_content" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"game_key" varchar(100) NOT NULL,
	"content_type" varchar(50) NOT NULL,
	"title" varchar(255),
	"content" text NOT NULL,
	"difficulty_level" varchar(50),
	"created_by" uuid NOT NULL,
	"is_approved" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"usage_count" integer DEFAULT 0,
	"average_rating" numeric(3, 2),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
CREATE TABLE "game_participant_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"game_session_id" uuid NOT NULL UNIQUE,
	"participant_id" uuid NOT NULL UNIQUE,
	"role_key" varchar(50) NOT NULL,
	"role_name" varchar(100) NOT NULL,
	"perspective" text NOT NULL,
	"goals" text[] NOT NULL,
	"hidden_agenda" text,
	"constraints" text[] DEFAULT ARRAY[],
	"stakeholders" text[] DEFAULT ARRAY[],
	"key_questions" text[] DEFAULT ARRAY[],
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "game_participant_roles_game_session_id_participant_id_key" UNIQUE("game_session_id","participant_id"),
	CONSTRAINT "valid_role_key" CHECK (((role_key)::text ~ '^[a-z_]+$'::text)),
	CONSTRAINT "valid_role_key_length" CHECK (((length((role_key)::text) >= 1) AND (length((role_key)::text) <= 50))),
	CONSTRAINT "valid_role_name" CHECK ((length((role_name)::text) > 0))
);
CREATE TABLE "game_results" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"game_session_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"score" integer DEFAULT 0,
	"rank" integer,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "game_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"game_session_id" uuid NOT NULL,
	"round_id" uuid,
	"participant_id" uuid NOT NULL,
	"statement_id" varchar(10) NOT NULL,
	"voted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uk_game_votes_participant_round" UNIQUE("game_session_id","round_id","participant_id")
);
CREATE TABLE "coffee_roulette_unpaired" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"game_session_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"reason" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uk_coffee_roulette_unpaired_session_participant" UNIQUE("game_session_id","participant_id")
);
CREATE TABLE "game_rounds" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"game_session_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"round_duration_seconds" integer DEFAULT 60,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"metadata" jsonb,
	"started_at" timestamp,
	"ended_at" timestamp,
	"round_deadline_at" timestamp,
	"batch_number" integer,
	"is_parallel" boolean DEFAULT false,
	"submission_deadline" timestamp,
	"voting_deadline" timestamp
);
CREATE TABLE "game_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"event_id" uuid NOT NULL,
	"game_type_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"current_round" integer DEFAULT 0,
	"game_duration_minutes" integer DEFAULT 30,
	"expires_at" timestamp,
	"metadata" jsonb,
	"started_at" timestamp,
	"ended_at" timestamp,
	"total_rounds" integer DEFAULT 4,
	"discussion_ends_at" timestamp,
	"debrief_sent_at" timestamp,
	"end_idempotency_key" varchar(255),
	"end_action_timestamp" timestamp with time zone,
	"role_assignment_completed_at" timestamp,
	"session_deadline_at" timestamp,
	"resolved_timing" jsonb,
	"execution_mode" varchar(20) DEFAULT 'sequential',
	"batch_size" integer DEFAULT 10,
	"total_batches" integer,
	"current_batch" integer DEFAULT 0,
	"team_mode" varchar(20) DEFAULT 'single',
	"team_size" integer DEFAULT 5,
	"total_teams" integer,
	"current_team_number" integer DEFAULT 0,
	"phase_transition_type" varchar(20) DEFAULT 'manual',
	"use_scheduled_deadlines" boolean DEFAULT false,
	"group_size" integer DEFAULT 2,
	"group_matching_algorithm" varchar(50) DEFAULT 'round-robin',
	CONSTRAINT "discussion_ends_after_start" CHECK (((discussion_ends_at IS NULL) OR (discussion_ends_at > started_at)))
);
CREATE TABLE "game_state_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"game_session_id" uuid NOT NULL,
	"state" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"action_sequence_number" bigint DEFAULT 0,
	"revision_number" bigint DEFAULT 1,
	"revision_timestamp" timestamp with time zone DEFAULT now(),
	"abandoned_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone,
	"last_active_socket_id" varchar(255),
	"last_rejoin_at" timestamp with time zone,
	"end_idempotency_key" varchar(255),
	"end_action_timestamp" timestamp with time zone
);
CREATE TABLE "game_team_results" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"game_session_id" uuid NOT NULL UNIQUE,
	"team_id" varchar(50) NOT NULL UNIQUE,
	"solution_summary" text,
	"approach" varchar(100),
	"effectiveness_score" integer,
	"creativity_score" integer,
	"collaboration_feedback" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "game_team_results_game_session_id_team_id_key" UNIQUE("game_session_id","team_id")
);
CREATE TABLE "game_teams" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"game_session_id" uuid NOT NULL UNIQUE,
	"team_number" integer NOT NULL UNIQUE,
	"team_id" varchar(50) NOT NULL UNIQUE,
	"participant_count" integer DEFAULT 0,
	"status" varchar(20) DEFAULT 'active',
	"discussion_channel_id" varchar(100),
	"final_solution" text,
	"team_created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "game_teams_game_session_id_team_id_key" UNIQUE("game_session_id","team_id"),
	CONSTRAINT "game_teams_game_session_id_team_number_key" UNIQUE("game_session_id","team_number")
);
CREATE TABLE "game_types" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"key" varchar(50) NOT NULL CONSTRAINT "game_types_key_key" UNIQUE,
	"name" varchar(100) NOT NULL,
	"category" varchar(50),
	"is_sync" boolean DEFAULT true,
	"min_players" integer DEFAULT 2,
	"max_players" integer DEFAULT 50,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "leaderboard_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"leaderboard_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"score" integer DEFAULT 0,
	"rank" integer,
	"updated_at" timestamp
);
CREATE TABLE "leaderboards" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"game_type_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"season" varchar(50),
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"user_id" uuid NOT NULL,
	"type" varchar(50) NOT NULL,
	"data" jsonb,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "organization_engagement_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" uuid NOT NULL CONSTRAINT "organization_engagement_metrics_organization_id_key" UNIQUE,
	"org_health_score" numeric(5, 2) DEFAULT '0',
	"total_members" integer DEFAULT 0,
	"active_members" integer DEFAULT 0,
	"inactive_members" integer DEFAULT 0,
	"total_sessions_this_month" integer DEFAULT 0,
	"total_sessions_last_month" integer DEFAULT 0,
	"member_growth_percentage" numeric(5, 2),
	"feature_adoption_percentage" numeric(5, 2),
	"last_activity_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
CREATE TABLE "organization_invitations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"organization_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"role_id" uuid NOT NULL,
	"invited_by_member_id" uuid,
	"token" varchar(255) NOT NULL CONSTRAINT "organization_invitations_token_key" UNIQUE,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"department_id" uuid
);
CREATE TABLE "organization_member_departments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"organization_member_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "organization_members" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"invited_by_member_id" uuid,
	"is_subscription_manager" boolean DEFAULT false,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"joined_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"name" varchar(100) NOT NULL,
	"slug" varchar(120) NOT NULL CONSTRAINT "organizations_slug_key" UNIQUE,
	"logo_url" text,
	"owner_user_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"description" text DEFAULT '',
	"industry" varchar(50),
	"company_size" varchar(20),
	"goals" text[] DEFAULT '{}',
	"status" varchar(20) DEFAULT 'real' NOT NULL,
	"ban_reason" text,
	CONSTRAINT "check_org_status" CHECK (((status)::text = ANY ((ARRAY['test'::character varying, 'real'::character varying, 'inactive'::character varying, 'banned'::character varying])::text[])))
);
CREATE TABLE "participants" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"event_id" uuid NOT NULL,
	"organization_member_id" uuid,
	"guest_name" varchar(100),
	"guest_avatar" varchar(255),
	"participant_type" varchar(20) DEFAULT 'member' NOT NULL,
	"invited_by_member_id" uuid,
	"joined_at" timestamp,
	"left_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"guest_identity_key" varchar(128)
);
CREATE TABLE "password_resets" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"email" varchar(255) NOT NULL,
	"token" varchar(255) NOT NULL CONSTRAINT "password_resets_token_key" UNIQUE,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"key" varchar(100) NOT NULL CONSTRAINT "permissions_key_key" UNIQUE,
	"description" text
);
CREATE TABLE "post_reactions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"post_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"reaction_type" varchar(50) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "posts_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"post_id" uuid NOT NULL UNIQUE,
	"tag" text NOT NULL UNIQUE,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"created_by_member_id" uuid,
	CONSTRAINT "posts_tags_post_id_tag_key" UNIQUE("post_id","tag")
);
CREATE TABLE "prompts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"game_type_id" uuid NOT NULL,
	"content" text NOT NULL,
	"category" varchar(50),
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "role_permissions" (
	"role_id" uuid,
	"permission_id" uuid,
	CONSTRAINT "role_permissions_pkey" PRIMARY KEY("role_id","permission_id")
);
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"name" varchar(50) NOT NULL CONSTRAINT "roles_name_key" UNIQUE,
	"description" text
);
CREATE TABLE "strategic_notes" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"game_session_id" uuid NOT NULL UNIQUE,
	"participant_id" uuid NOT NULL UNIQUE,
	"content" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "strategic_notes_game_session_id_participant_id_key" UNIQUE("game_session_id","participant_id")
);
CREATE TABLE "strategic_roles" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"game_session_id" uuid NOT NULL UNIQUE,
	"participant_id" uuid NOT NULL UNIQUE,
	"role_key" varchar(50) NOT NULL,
	"email_sent_at" timestamp,
	"revealed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"ready_at" timestamp,
	"prompt_index" integer DEFAULT 0 NOT NULL,
	"prompt_updated_at" timestamp,
	"team_id" varchar(50),
	"team_number" integer,
	CONSTRAINT "strategic_roles_game_session_id_participant_id_key" UNIQUE("game_session_id","participant_id")
);
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"organization_id" uuid NOT NULL,
	"plan_name" varchar(50) DEFAULT 'free' NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"max_users" integer DEFAULT 10,
	"max_events" integer DEFAULT 5,
	"billing_email" varchar(255),
	"started_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp
);
CREATE TABLE "user_engagement_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL CONSTRAINT "user_engagement_metrics_user_id_key" UNIQUE,
	"engagement_score" numeric(5, 2) DEFAULT '0',
	"last_active_at" timestamp,
	"total_sessions" integer DEFAULT 0,
	"total_messages_sent" integer DEFAULT 0,
	"total_actions_performed" integer DEFAULT 0,
	"avg_session_duration_minutes" integer DEFAULT 0,
	"favorite_game_type" varchar(100),
	"is_active" boolean DEFAULT true,
	"is_inactive_30d" boolean DEFAULT false,
	"is_vip" boolean DEFAULT false,
	"user_tags" varchar(255)[],
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"user_id" uuid NOT NULL,
	"refresh_token" varchar(512) NOT NULL,
	"ip_address" varchar(45),
	"user_agent" text,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
	"email" varchar(255) NOT NULL CONSTRAINT "users_email_key" UNIQUE,
	"password_hash" varchar(255) NOT NULL,
	"name" varchar(100) NOT NULL,
	"avatar_url" text,
	"language" varchar(10) DEFAULT 'en' NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"onboarding_completed" boolean DEFAULT false NOT NULL,
	"last_active_at" timestamp
);
CREATE TABLE "win_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" uuid NOT NULL UNIQUE,
	"key" varchar(50) NOT NULL UNIQUE,
	"label" varchar(255) NOT NULL,
	"description" text,
	"color" varchar(20),
	"icon" varchar(50),
	"order_index" integer DEFAULT 0,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "win_categories_organization_id_key_key" UNIQUE("organization_id","key")
);
CREATE UNIQUE INDEX "_migrations_pkey" ON "_migrations" ("version");
CREATE UNIQUE INDEX "activity_feedbacks_pkey" ON "activity_feedbacks" ("id");
CREATE INDEX "idx_activity_feedbacks_event_created" ON "activity_feedbacks" ("event_id","created_at");
CREATE INDEX "idx_activity_feedbacks_game_type_created" ON "activity_feedbacks" ("game_type_key","created_at");
CREATE INDEX "idx_activity_feedbacks_participant_created" ON "activity_feedbacks" ("participant_id","created_at");
CREATE INDEX "idx_activity_feedbacks_rating" ON "activity_feedbacks" ("rating");
CREATE UNIQUE INDEX "activity_posts_pkey" ON "activity_posts" ("id");
CREATE INDEX "idx_activity_posts_category" ON "activity_posts" ("category");
CREATE INDEX "idx_activity_posts_category_event_id" ON "activity_posts" ("event_id","category");
CREATE INDEX "idx_activity_posts_tags_gin" ON "activity_posts" USING gin ("tags");
CREATE UNIQUE INDEX "analytics_events_pkey" ON "analytics_events" ("id");
CREATE INDEX "idx_analytics_events_created" ON "analytics_events" ("created_at");
CREATE INDEX "idx_analytics_events_name" ON "analytics_events" ("event_name");
CREATE INDEX "idx_analytics_user_created" ON "analytics_events" ("user_id","created_at");
CREATE UNIQUE INDEX "analytics_reports_pkey" ON "analytics_reports" ("id");
CREATE INDEX "idx_analytics_reports_type" ON "analytics_reports" ("report_type");
CREATE UNIQUE INDEX "audit_logs_pkey" ON "audit_logs" ("id");
CREATE INDEX "idx_audit_logs_action" ON "audit_logs" ("action");
CREATE INDEX "idx_audit_logs_created" ON "audit_logs" ("created_at");
CREATE INDEX "idx_audit_logs_org" ON "audit_logs" ("organization_id");
CREATE INDEX "idx_audit_logs_user" ON "audit_logs" ("user_id");
CREATE UNIQUE INDEX "batch_assignments_game_session_id_batch_number_participant__key" ON "batch_assignments" ("game_session_id","batch_number","participant_id");
CREATE UNIQUE INDEX "batch_assignments_pkey" ON "batch_assignments" ("id");
CREATE INDEX "idx_batch_assignments_batch" ON "batch_assignments" ("game_session_id","batch_number");
CREATE INDEX "idx_batch_assignments_presenter" ON "batch_assignments" ("game_session_id","presenter_index");
CREATE INDEX "idx_batch_assignments_session" ON "batch_assignments" ("game_session_id");
CREATE UNIQUE INDEX "bug_report_attachments_pkey" ON "bug_report_attachments" ("id");
CREATE INDEX "idx_bug_attachments_report" ON "bug_report_attachments" ("bug_report_id");
CREATE INDEX "idx_bug_attachments_uploader" ON "bug_report_attachments" ("uploaded_by_user_id");
CREATE UNIQUE INDEX "bug_report_history_pkey" ON "bug_report_history" ("id");
CREATE INDEX "idx_bug_history_created" ON "bug_report_history" ("created_at");
CREATE INDEX "idx_bug_history_report" ON "bug_report_history" ("bug_report_id");
CREATE INDEX "idx_bug_history_user" ON "bug_report_history" ("changed_by_user_id");
CREATE UNIQUE INDEX "bug_reports_pkey" ON "bug_reports" ("id");
CREATE INDEX "idx_bug_reports_assigned" ON "bug_reports" ("assigned_to_user_id");
CREATE INDEX "idx_bug_reports_created" ON "bug_reports" ("created_at");
CREATE INDEX "idx_bug_reports_priority" ON "bug_reports" ("priority");
CREATE INDEX "idx_bug_reports_status" ON "bug_reports" ("status");
CREATE INDEX "idx_bug_reports_type" ON "bug_reports" ("type");
CREATE INDEX "idx_bug_reports_user" ON "bug_reports" ("user_id");
CREATE UNIQUE INDEX "coffee_groups_game_session_id_group_id_key" ON "coffee_groups" ("game_session_id","group_id");
CREATE UNIQUE INDEX "coffee_groups_game_session_id_group_number_key" ON "coffee_groups" ("game_session_id","group_number");
CREATE UNIQUE INDEX "coffee_groups_pkey" ON "coffee_groups" ("id");
CREATE INDEX "idx_coffee_groups_deadline" ON "coffee_groups" ("game_session_id","chat_ends_at");
CREATE INDEX "idx_coffee_groups_session" ON "coffee_groups" ("game_session_id");
CREATE INDEX "idx_coffee_groups_status" ON "coffee_groups" ("game_session_id","status");
CREATE UNIQUE INDEX "coffee_roulette_config_event_id_key" ON "coffee_roulette_config" ("event_id");
CREATE UNIQUE INDEX "coffee_roulette_config_pkey" ON "coffee_roulette_config" ("id");
CREATE INDEX "idx_coffee_roulette_config_event" ON "coffee_roulette_config" ("event_id");
CREATE INDEX "idx_coffee_roulette_config_org_event" ON "coffee_roulette_config" ("created_by_member_id");
CREATE UNIQUE INDEX "coffee_roulette_config_audit_pkey" ON "coffee_roulette_config_audit" ("id");
CREATE INDEX "idx_coffee_roulette_config_audit_config" ON "coffee_roulette_config_audit" ("config_id");
CREATE INDEX "idx_coffee_roulette_config_audit_member" ON "coffee_roulette_config_audit" ("changed_by_member_id");
CREATE INDEX "idx_coffee_roulette_config_audit_timestamp" ON "coffee_roulette_config_audit" ("created_at");
CREATE UNIQUE INDEX "coffee_roulette_pair_context_pkey" ON "coffee_roulette_pair_context" ("id");
CREATE INDEX "idx_coffee_roulette_pair_context_event" ON "coffee_roulette_pair_context" ("event_id");
CREATE INDEX "idx_coffee_roulette_pair_context_session" ON "coffee_roulette_pair_context" ("session_start_time");
CREATE INDEX "idx_coffee_roulette_pair_context_topic" ON "coffee_roulette_pair_context" ("topic_id");
CREATE UNIQUE INDEX "coffee_roulette_questions_pkey" ON "coffee_roulette_questions" ("id");
CREATE INDEX "idx_coffee_roulette_questions_active" ON "coffee_roulette_questions" ("config_id","is_active");
CREATE INDEX "idx_coffee_roulette_questions_config" ON "coffee_roulette_questions" ("config_id");
CREATE INDEX "idx_coffee_roulette_questions_order" ON "coffee_roulette_questions" ("config_id","display_order");
CREATE INDEX "idx_coffee_roulette_questions_type" ON "coffee_roulette_questions" ("config_id","question_type");
CREATE UNIQUE INDEX "coffee_roulette_topic_questions_pkey" ON "coffee_roulette_topic_questions" ("id");
CREATE UNIQUE INDEX "coffee_roulette_topic_questions_topic_id_question_id_key" ON "coffee_roulette_topic_questions" ("topic_id","question_id");
CREATE INDEX "idx_coffee_roulette_topic_questions_question" ON "coffee_roulette_topic_questions" ("question_id");
CREATE INDEX "idx_coffee_roulette_topic_questions_topic" ON "coffee_roulette_topic_questions" ("topic_id");
CREATE UNIQUE INDEX "coffee_roulette_topics_pkey" ON "coffee_roulette_topics" ("id");
CREATE INDEX "idx_coffee_roulette_topics_active" ON "coffee_roulette_topics" ("config_id","is_active");
CREATE INDEX "idx_coffee_roulette_topics_config" ON "coffee_roulette_topics" ("config_id");
CREATE INDEX "idx_coffee_roulette_topics_order" ON "coffee_roulette_topics" ("config_id","display_order");
CREATE UNIQUE INDEX "contact_submissions_pkey" ON "contact_submissions" ("id");
CREATE INDEX "idx_contact_created" ON "contact_submissions" ("created_at");
CREATE INDEX "idx_contact_submissions_created" ON "contact_submissions" ("created_at");
CREATE INDEX "idx_contact_submissions_status" ON "contact_submissions" ("status");
CREATE UNIQUE INDEX "content_moderation_queue_pkey" ON "content_moderation_queue" ("id");
CREATE INDEX "idx_content_moderation_status" ON "content_moderation_queue" ("status");
CREATE UNIQUE INDEX "departments_pkey" ON "departments" ("id");
CREATE UNIQUE INDEX "idx_departments_org_name" ON "departments" ("organization_id","name");
CREATE UNIQUE INDEX "early_access_requests_pkey" ON "early_access_requests" ("id");
CREATE INDEX "idx_early_access_requests_account_provisioned" ON "early_access_requests" ("account_provisioned_at");
CREATE INDEX "idx_early_access_requests_created" ON "early_access_requests" ("created_at");
CREATE INDEX "idx_early_access_requests_email" ON "early_access_requests" ("email");
CREATE INDEX "idx_early_access_requests_email_sent" ON "early_access_requests" ("credentials_email_sent_at");
CREATE INDEX "idx_early_access_requests_provisioned_user" ON "early_access_requests" ("provisioned_user_id");
CREATE UNIQUE INDEX "email_verifications_pkey" ON "email_verifications" ("id");
CREATE UNIQUE INDEX "email_verifications_token_key" ON "email_verifications" ("token");
CREATE INDEX "idx_email_verifications_otp" ON "email_verifications" ("otp_code");
CREATE INDEX "idx_email_verifications_token" ON "email_verifications" ("token");
CREATE UNIQUE INDEX "event_invitations_pkey" ON "event_invitations" ("id");
CREATE UNIQUE INDEX "event_invitations_token_key" ON "event_invitations" ("token");
CREATE INDEX "idx_event_invitations_token" ON "event_invitations" ("token");
CREATE UNIQUE INDEX "event_messages_pkey" ON "event_messages" ("id");
CREATE INDEX "idx_event_messages_created" ON "event_messages" ("event_id","created_at");
CREATE INDEX "idx_event_messages_event" ON "event_messages" ("event_id");
CREATE UNIQUE INDEX "event_profiles_event_id_participant_id_key" ON "event_profiles" ("event_id","participant_id");
CREATE UNIQUE INDEX "event_profiles_pkey" ON "event_profiles" ("id");
CREATE INDEX "idx_event_profiles_event" ON "event_profiles" ("event_id");
CREATE INDEX "idx_event_profiles_participant" ON "event_profiles" ("participant_id");
CREATE UNIQUE INDEX "event_settings_pkey" ON "event_settings" ("event_id");
CREATE UNIQUE INDEX "events_pkey" ON "events" ("id");
CREATE INDEX "idx_events_created" ON "events" ("created_at");
CREATE INDEX "idx_events_org" ON "events" ("organization_id");
CREATE INDEX "idx_events_org_created" ON "events" ("organization_id","created_at");
CREATE INDEX "idx_events_org_status" ON "events" ("organization_id","status");
CREATE INDEX "idx_events_status" ON "events" ("status");
CREATE UNIQUE INDEX "feature_flag_evaluations_pkey" ON "feature_flag_evaluations" ("id");
CREATE INDEX "idx_feature_flag_evaluations_flag" ON "feature_flag_evaluations" ("flag_id");
CREATE INDEX "idx_feature_flag_evaluations_user" ON "feature_flag_evaluations" ("user_id");
CREATE UNIQUE INDEX "feature_flags_key_key" ON "feature_flags" ("key");
CREATE UNIQUE INDEX "feature_flags_pkey" ON "feature_flags" ("id");
CREATE INDEX "idx_feature_flags_enabled" ON "feature_flags" ("enabled");
CREATE INDEX "idx_feature_flags_key" ON "feature_flags" ("key");
CREATE UNIQUE INDEX "files_pkey" ON "files" ("id");
CREATE INDEX "idx_files_owner" ON "files" ("owner_user_id");
CREATE UNIQUE INDEX "game_actions_pkey" ON "game_actions" ("id");
CREATE INDEX "idx_game_actions_round" ON "game_actions" ("round_id");
CREATE INDEX "idx_game_actions_session" ON "game_actions" ("game_session_id");
CREATE INDEX "idx_game_actions_session_participant" ON "game_actions" ("game_session_id","participant_id");
CREATE INDEX "idx_game_actions_timestamp" ON "game_actions" ("created_at");
CREATE UNIQUE INDEX "game_content_pkey" ON "game_content" ("id");
CREATE INDEX "idx_game_content_approved" ON "game_content" ("is_approved");
CREATE INDEX "idx_game_content_game_key" ON "game_content" ("game_key");
CREATE UNIQUE INDEX "game_participant_roles_game_session_id_participant_id_key" ON "game_participant_roles" ("game_session_id","participant_id");
CREATE UNIQUE INDEX "game_participant_roles_pkey" ON "game_participant_roles" ("id");
CREATE INDEX "idx_game_participant_roles_key" ON "game_participant_roles" ("role_key");
CREATE INDEX "idx_game_participant_roles_participant" ON "game_participant_roles" ("participant_id");
CREATE INDEX "idx_game_participant_roles_session" ON "game_participant_roles" ("game_session_id");
CREATE UNIQUE INDEX "game_results_pkey" ON "game_results" ("id");
CREATE UNIQUE INDEX "idx_game_results_unique" ON "game_results" ("game_session_id","participant_id");
CREATE UNIQUE INDEX "game_votes_pkey" ON "game_votes" ("id");
CREATE INDEX "idx_game_votes_session" ON "game_votes" ("game_session_id");
CREATE INDEX "idx_game_votes_round" ON "game_votes" ("round_id");
CREATE INDEX "idx_game_votes_participant" ON "game_votes" ("participant_id");
CREATE INDEX "idx_game_votes_timestamp" ON "game_votes" ("voted_at");
CREATE UNIQUE INDEX "coffee_roulette_unpaired_pkey" ON "coffee_roulette_unpaired" ("id");
CREATE INDEX "idx_coffee_roulette_unpaired_session" ON "coffee_roulette_unpaired" ("game_session_id");
CREATE INDEX "idx_coffee_roulette_unpaired_participant" ON "coffee_roulette_unpaired" ("participant_id");
CREATE INDEX "idx_coffee_roulette_unpaired_created" ON "coffee_roulette_unpaired" ("created_at");
CREATE UNIQUE INDEX "game_rounds_pkey" ON "game_rounds" ("id");
CREATE INDEX "idx_game_rounds_batch_deadline" ON "game_rounds" ("game_session_id","batch_number","voting_deadline");
CREATE INDEX "idx_game_rounds_deadline_active" ON "game_rounds" ("round_deadline_at");
CREATE UNIQUE INDEX "idx_game_rounds_unique" ON "game_rounds" ("game_session_id","round_number");
CREATE UNIQUE INDEX "game_sessions_pkey" ON "game_sessions" ("id");
CREATE INDEX "idx_game_sessions_deadline_active" ON "game_sessions" ("session_deadline_at");
CREATE INDEX "idx_game_sessions_discussion_timeout" ON "game_sessions" ("discussion_ends_at");
CREATE INDEX "idx_game_sessions_event" ON "game_sessions" ("event_id");
CREATE INDEX "idx_game_sessions_event_status" ON "game_sessions" ("event_id","status");
CREATE INDEX "idx_game_sessions_execution_mode" ON "game_sessions" ("event_id","execution_mode");
CREATE INDEX "idx_game_sessions_pending_debrief" ON "game_sessions" ("id");
CREATE INDEX "idx_game_sessions_phase_transition" ON "game_sessions" ("event_id","phase_transition_type");
CREATE INDEX "idx_game_sessions_status" ON "game_sessions" ("status");
CREATE INDEX "idx_game_sessions_team_mode" ON "game_sessions" ("event_id","team_mode");
CREATE UNIQUE INDEX "game_state_snapshots_pkey" ON "game_state_snapshots" ("id");
CREATE INDEX "idx_game_snapshots_abandoned" ON "game_state_snapshots" ("game_session_id");
CREATE INDEX "idx_game_snapshots_end_key" ON "game_state_snapshots" ("end_idempotency_key");
CREATE INDEX "idx_game_snapshots_revision" ON "game_state_snapshots" ("game_session_id","revision_number");
CREATE INDEX "idx_game_snapshots_sequence" ON "game_state_snapshots" ("game_session_id","action_sequence_number");
CREATE UNIQUE INDEX "game_team_results_game_session_id_team_id_key" ON "game_team_results" ("game_session_id","team_id");
CREATE UNIQUE INDEX "game_team_results_pkey" ON "game_team_results" ("id");
CREATE INDEX "idx_game_team_results_session" ON "game_team_results" ("game_session_id");
CREATE UNIQUE INDEX "game_teams_game_session_id_team_id_key" ON "game_teams" ("game_session_id","team_id");
CREATE UNIQUE INDEX "game_teams_game_session_id_team_number_key" ON "game_teams" ("game_session_id","team_number");
CREATE UNIQUE INDEX "game_teams_pkey" ON "game_teams" ("id");
CREATE INDEX "idx_game_teams_session" ON "game_teams" ("game_session_id");
CREATE INDEX "idx_game_teams_team_id" ON "game_teams" ("game_session_id","team_id");
CREATE UNIQUE INDEX "game_types_key_key" ON "game_types" ("key");
CREATE UNIQUE INDEX "game_types_pkey" ON "game_types" ("id");
CREATE INDEX "idx_leaderboard_entries_rank" ON "leaderboard_entries" ("leaderboard_id","rank");
CREATE UNIQUE INDEX "idx_leaderboard_entries_unique" ON "leaderboard_entries" ("leaderboard_id","participant_id");
CREATE UNIQUE INDEX "leaderboard_entries_pkey" ON "leaderboard_entries" ("id");
CREATE UNIQUE INDEX "leaderboards_pkey" ON "leaderboards" ("id");
CREATE INDEX "idx_notifications_unread" ON "notifications" ("user_id");
CREATE INDEX "idx_notifications_user" ON "notifications" ("user_id");
CREATE INDEX "idx_notifications_user_created" ON "notifications" ("user_id","created_at");
CREATE UNIQUE INDEX "notifications_pkey" ON "notifications" ("id");
CREATE INDEX "idx_org_engagement_health" ON "organization_engagement_metrics" ("org_health_score");
CREATE UNIQUE INDEX "organization_engagement_metrics_organization_id_key" ON "organization_engagement_metrics" ("organization_id");
CREATE UNIQUE INDEX "organization_engagement_metrics_pkey" ON "organization_engagement_metrics" ("id");
CREATE INDEX "idx_org_invitations_email" ON "organization_invitations" ("email");
CREATE INDEX "idx_org_invitations_token" ON "organization_invitations" ("token");
CREATE UNIQUE INDEX "organization_invitations_pkey" ON "organization_invitations" ("id");
CREATE UNIQUE INDEX "organization_invitations_token_key" ON "organization_invitations" ("token");
CREATE UNIQUE INDEX "idx_org_member_departments_unique" ON "organization_member_departments" ("organization_member_id");
CREATE UNIQUE INDEX "organization_member_departments_pkey" ON "organization_member_departments" ("id");
CREATE UNIQUE INDEX "idx_org_members_unique" ON "organization_members" ("organization_id","user_id");
CREATE INDEX "idx_org_members_user" ON "organization_members" ("user_id");
CREATE UNIQUE INDEX "organization_members_pkey" ON "organization_members" ("id");
CREATE INDEX "idx_organizations_created" ON "organizations" ("created_at");
CREATE INDEX "idx_organizations_owner" ON "organizations" ("owner_user_id");
CREATE INDEX "idx_organizations_status" ON "organizations" ("status");
CREATE UNIQUE INDEX "organizations_pkey" ON "organizations" ("id");
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations" ("slug");
CREATE UNIQUE INDEX "idx_participants_active" ON "participants" ("event_id","organization_member_id");
CREATE INDEX "idx_participants_active_range" ON "participants" ("event_id","left_at","joined_at");
CREATE INDEX "idx_participants_event" ON "participants" ("event_id");
CREATE INDEX "idx_participants_event_active" ON "participants" ("event_id");
CREATE INDEX "idx_participants_guest_identity_lookup" ON "participants" ("event_id","guest_identity_key");
CREATE UNIQUE INDEX "idx_participants_guest_identity_unique_active" ON "participants" ("event_id","guest_identity_key");
CREATE INDEX "idx_participants_member" ON "participants" ("organization_member_id");
CREATE UNIQUE INDEX "idx_participants_unique_active_member_event" ON "participants" ("event_id","organization_member_id");
CREATE UNIQUE INDEX "participants_pkey" ON "participants" ("id");
CREATE INDEX "idx_password_resets_email" ON "password_resets" ("email");
CREATE INDEX "idx_password_resets_token" ON "password_resets" ("token");
CREATE UNIQUE INDEX "password_resets_pkey" ON "password_resets" ("id");
CREATE UNIQUE INDEX "password_resets_token_key" ON "password_resets" ("token");
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions" ("key");
CREATE UNIQUE INDEX "permissions_pkey" ON "permissions" ("id");
CREATE UNIQUE INDEX "idx_post_reactions_unique" ON "post_reactions" ("post_id","participant_id","reaction_type");
CREATE UNIQUE INDEX "post_reactions_pkey" ON "post_reactions" ("id");
CREATE INDEX "idx_posts_tags_post_id" ON "posts_tags" ("post_id");
CREATE INDEX "idx_posts_tags_tag" ON "posts_tags" ("tag");
CREATE UNIQUE INDEX "posts_tags_pkey" ON "posts_tags" ("id");
CREATE UNIQUE INDEX "posts_tags_post_id_tag_key" ON "posts_tags" ("post_id","tag");
CREATE UNIQUE INDEX "prompts_pkey" ON "prompts" ("id");
CREATE UNIQUE INDEX "role_permissions_pkey" ON "role_permissions" ("role_id","permission_id");
CREATE UNIQUE INDEX "roles_name_key" ON "roles" ("name");
CREATE UNIQUE INDEX "roles_pkey" ON "roles" ("id");
CREATE INDEX "idx_strategic_notes_session" ON "strategic_notes" ("game_session_id");
CREATE UNIQUE INDEX "strategic_notes_game_session_id_participant_id_key" ON "strategic_notes" ("game_session_id","participant_id");
CREATE UNIQUE INDEX "strategic_notes_pkey" ON "strategic_notes" ("id");
CREATE INDEX "idx_strategic_roles_prompt_index" ON "strategic_roles" ("game_session_id","prompt_index");
CREATE INDEX "idx_strategic_roles_ready_at" ON "strategic_roles" ("game_session_id","ready_at");
CREATE INDEX "idx_strategic_roles_revealed_at" ON "strategic_roles" ("game_session_id","revealed_at");
CREATE INDEX "idx_strategic_roles_session" ON "strategic_roles" ("game_session_id");
CREATE INDEX "idx_strategic_roles_team_id" ON "strategic_roles" ("game_session_id","team_id");
CREATE UNIQUE INDEX "strategic_roles_game_session_id_participant_id_key" ON "strategic_roles" ("game_session_id","participant_id");
CREATE UNIQUE INDEX "strategic_roles_pkey" ON "strategic_roles" ("id");
CREATE UNIQUE INDEX "idx_subscriptions_org" ON "subscriptions" ("organization_id");
CREATE UNIQUE INDEX "subscriptions_pkey" ON "subscriptions" ("id");
CREATE INDEX "idx_user_engagement_score" ON "user_engagement_metrics" ("engagement_score");
CREATE UNIQUE INDEX "user_engagement_metrics_pkey" ON "user_engagement_metrics" ("id");
CREATE UNIQUE INDEX "user_engagement_metrics_user_id_key" ON "user_engagement_metrics" ("user_id");
CREATE INDEX "idx_user_sessions_expires" ON "user_sessions" ("expires_at");
CREATE INDEX "idx_user_sessions_refresh_token" ON "user_sessions" ("refresh_token");
CREATE INDEX "idx_user_sessions_user_id" ON "user_sessions" ("user_id");
CREATE UNIQUE INDEX "user_sessions_pkey" ON "user_sessions" ("id");
CREATE INDEX "idx_users_created" ON "users" ("created_at");
CREATE INDEX "idx_users_email" ON "users" ("email");
CREATE INDEX "idx_users_last_active" ON "users" ("last_active_at");
CREATE INDEX "idx_users_onboarding" ON "users" ("onboarding_completed");
CREATE INDEX "idx_users_status" ON "users" ("status");
CREATE INDEX "idx_users_updated" ON "users" ("updated_at");
CREATE UNIQUE INDEX "users_email_key" ON "users" ("email");
CREATE UNIQUE INDEX "users_pkey" ON "users" ("id");
CREATE INDEX "idx_win_categories_key" ON "win_categories" ("key");
CREATE INDEX "idx_win_categories_org_id" ON "win_categories" ("organization_id");
CREATE UNIQUE INDEX "win_categories_organization_id_key_key" ON "win_categories" ("organization_id","key");
CREATE UNIQUE INDEX "win_categories_pkey" ON "win_categories" ("id");
ALTER TABLE "activity_feedbacks" ADD CONSTRAINT "activity_feedbacks_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE;
ALTER TABLE "activity_feedbacks" ADD CONSTRAINT "activity_feedbacks_game_session_id_fkey" FOREIGN KEY ("game_session_id") REFERENCES "game_sessions"("id") ON DELETE SET NULL;
ALTER TABLE "activity_feedbacks" ADD CONSTRAINT "activity_feedbacks_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE CASCADE;
ALTER TABLE "activity_posts" ADD CONSTRAINT "activity_posts_author_participant_id_fkey" FOREIGN KEY ("author_participant_id") REFERENCES "participants"("id") ON DELETE CASCADE;
ALTER TABLE "activity_posts" ADD CONSTRAINT "activity_posts_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE;
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "analytics_reports" ADD CONSTRAINT "analytics_reports_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "batch_assignments" ADD CONSTRAINT "batch_assignments_game_session_id_fkey" FOREIGN KEY ("game_session_id") REFERENCES "game_sessions"("id") ON DELETE CASCADE;
ALTER TABLE "batch_assignments" ADD CONSTRAINT "batch_assignments_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE CASCADE;
ALTER TABLE "bug_report_attachments" ADD CONSTRAINT "bug_report_attachments_bug_report_id_fkey" FOREIGN KEY ("bug_report_id") REFERENCES "bug_reports"("id") ON DELETE CASCADE;
ALTER TABLE "bug_report_attachments" ADD CONSTRAINT "bug_report_attachments_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "bug_report_history" ADD CONSTRAINT "bug_report_history_bug_report_id_fkey" FOREIGN KEY ("bug_report_id") REFERENCES "bug_reports"("id") ON DELETE CASCADE;
ALTER TABLE "bug_report_history" ADD CONSTRAINT "bug_report_history_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "coffee_groups" ADD CONSTRAINT "coffee_groups_game_session_id_fkey" FOREIGN KEY ("game_session_id") REFERENCES "game_sessions"("id") ON DELETE CASCADE;
ALTER TABLE "coffee_roulette_config" ADD CONSTRAINT "coffee_roulette_config_created_by_member_id_fkey" FOREIGN KEY ("created_by_member_id") REFERENCES "organization_members"("id") ON DELETE SET NULL;
ALTER TABLE "coffee_roulette_config" ADD CONSTRAINT "coffee_roulette_config_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE;
ALTER TABLE "coffee_roulette_config_audit" ADD CONSTRAINT "coffee_roulette_config_audit_changed_by_member_id_fkey" FOREIGN KEY ("changed_by_member_id") REFERENCES "organization_members"("id") ON DELETE SET NULL;
ALTER TABLE "coffee_roulette_config_audit" ADD CONSTRAINT "coffee_roulette_config_audit_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "coffee_roulette_config"("id") ON DELETE CASCADE;
ALTER TABLE "coffee_roulette_pair_context" ADD CONSTRAINT "coffee_roulette_pair_context_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE;
ALTER TABLE "coffee_roulette_pair_context" ADD CONSTRAINT "coffee_roulette_pair_context_participant1_id_fkey" FOREIGN KEY ("participant1_id") REFERENCES "participants"("id") ON DELETE CASCADE;
ALTER TABLE "coffee_roulette_pair_context" ADD CONSTRAINT "coffee_roulette_pair_context_participant2_id_fkey" FOREIGN KEY ("participant2_id") REFERENCES "participants"("id") ON DELETE CASCADE;
ALTER TABLE "coffee_roulette_pair_context" ADD CONSTRAINT "coffee_roulette_pair_context_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "coffee_roulette_topics"("id") ON DELETE SET NULL;
ALTER TABLE "coffee_roulette_questions" ADD CONSTRAINT "coffee_roulette_questions_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "coffee_roulette_config"("id") ON DELETE CASCADE;
ALTER TABLE "coffee_roulette_questions" ADD CONSTRAINT "coffee_roulette_questions_created_by_member_id_fkey" FOREIGN KEY ("created_by_member_id") REFERENCES "organization_members"("id") ON DELETE SET NULL;
ALTER TABLE "coffee_roulette_topic_questions" ADD CONSTRAINT "coffee_roulette_topic_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "coffee_roulette_questions"("id") ON DELETE CASCADE;
ALTER TABLE "coffee_roulette_topic_questions" ADD CONSTRAINT "coffee_roulette_topic_questions_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "coffee_roulette_topics"("id") ON DELETE CASCADE;
ALTER TABLE "coffee_roulette_topics" ADD CONSTRAINT "coffee_roulette_topics_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "coffee_roulette_config"("id") ON DELETE CASCADE;
ALTER TABLE "coffee_roulette_topics" ADD CONSTRAINT "coffee_roulette_topics_created_by_member_id_fkey" FOREIGN KEY ("created_by_member_id") REFERENCES "organization_members"("id") ON DELETE SET NULL;
ALTER TABLE "content_moderation_queue" ADD CONSTRAINT "content_moderation_queue_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "game_content"("id") ON DELETE CASCADE;
ALTER TABLE "content_moderation_queue" ADD CONSTRAINT "content_moderation_queue_flagged_by_fkey" FOREIGN KEY ("flagged_by") REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "content_moderation_queue" ADD CONSTRAINT "content_moderation_queue_moderated_by_fkey" FOREIGN KEY ("moderated_by") REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "departments" ADD CONSTRAINT "departments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;
ALTER TABLE "early_access_requests" ADD CONSTRAINT "early_access_requests_provisioned_user_id_fkey" FOREIGN KEY ("provisioned_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "email_verifications" ADD CONSTRAINT "email_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "event_invitations" ADD CONSTRAINT "event_invitations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE;
ALTER TABLE "event_invitations" ADD CONSTRAINT "event_invitations_invited_by_member_id_fkey" FOREIGN KEY ("invited_by_member_id") REFERENCES "organization_members"("id");
ALTER TABLE "event_messages" ADD CONSTRAINT "event_messages_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE;
ALTER TABLE "event_messages" ADD CONSTRAINT "event_messages_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE CASCADE;
ALTER TABLE "event_profiles" ADD CONSTRAINT "event_profiles_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE;
ALTER TABLE "event_profiles" ADD CONSTRAINT "event_profiles_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE CASCADE;
ALTER TABLE "event_settings" ADD CONSTRAINT "event_settings_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE;
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_member_id_fkey" FOREIGN KEY ("created_by_member_id") REFERENCES "organization_members"("id");
ALTER TABLE "events" ADD CONSTRAINT "events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;
ALTER TABLE "events" ADD CONSTRAINT "events_pinned_message_id_fkey" FOREIGN KEY ("pinned_message_id") REFERENCES "event_messages"("id") ON DELETE SET NULL;
ALTER TABLE "feature_flag_evaluations" ADD CONSTRAINT "feature_flag_evaluations_flag_id_fkey" FOREIGN KEY ("flag_id") REFERENCES "feature_flags"("id") ON DELETE CASCADE;
ALTER TABLE "feature_flag_evaluations" ADD CONSTRAINT "feature_flag_evaluations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL;
ALTER TABLE "feature_flag_evaluations" ADD CONSTRAINT "feature_flag_evaluations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "files" ADD CONSTRAINT "files_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "game_actions" ADD CONSTRAINT "game_actions_game_session_id_fkey" FOREIGN KEY ("game_session_id") REFERENCES "game_sessions"("id") ON DELETE CASCADE;
ALTER TABLE "game_actions" ADD CONSTRAINT "game_actions_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE CASCADE;
ALTER TABLE "game_actions" ADD CONSTRAINT "game_actions_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "game_rounds"("id");
ALTER TABLE "game_content" ADD CONSTRAINT "game_content_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "game_participant_roles" ADD CONSTRAINT "game_participant_roles_game_session_id_fkey" FOREIGN KEY ("game_session_id") REFERENCES "game_sessions"("id") ON DELETE CASCADE;
ALTER TABLE "game_participant_roles" ADD CONSTRAINT "game_participant_roles_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE CASCADE;
ALTER TABLE "game_results" ADD CONSTRAINT "game_results_game_session_id_fkey" FOREIGN KEY ("game_session_id") REFERENCES "game_sessions"("id") ON DELETE CASCADE;
ALTER TABLE "game_results" ADD CONSTRAINT "game_results_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE CASCADE;
ALTER TABLE "game_votes" ADD CONSTRAINT "game_votes_game_session_id_fkey" FOREIGN KEY ("game_session_id") REFERENCES "game_sessions"("id") ON DELETE CASCADE;
ALTER TABLE "game_votes" ADD CONSTRAINT "game_votes_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "game_rounds"("id") ON DELETE SET NULL;
ALTER TABLE "game_votes" ADD CONSTRAINT "game_votes_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE CASCADE;
ALTER TABLE "coffee_roulette_unpaired" ADD CONSTRAINT "coffee_roulette_unpaired_game_session_id_fkey" FOREIGN KEY ("game_session_id") REFERENCES "game_sessions"("id") ON DELETE CASCADE;
ALTER TABLE "coffee_roulette_unpaired" ADD CONSTRAINT "coffee_roulette_unpaired_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE CASCADE;
ALTER TABLE "game_rounds" ADD CONSTRAINT "game_rounds_game_session_id_fkey" FOREIGN KEY ("game_session_id") REFERENCES "game_sessions"("id") ON DELETE CASCADE;
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE;
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_game_type_id_fkey" FOREIGN KEY ("game_type_id") REFERENCES "game_types"("id");
ALTER TABLE "game_state_snapshots" ADD CONSTRAINT "game_state_snapshots_game_session_id_fkey" FOREIGN KEY ("game_session_id") REFERENCES "game_sessions"("id") ON DELETE CASCADE;
ALTER TABLE "game_team_results" ADD CONSTRAINT "game_team_results_game_session_id_fkey" FOREIGN KEY ("game_session_id") REFERENCES "game_sessions"("id") ON DELETE CASCADE;
ALTER TABLE "game_teams" ADD CONSTRAINT "game_teams_game_session_id_fkey" FOREIGN KEY ("game_session_id") REFERENCES "game_sessions"("id") ON DELETE CASCADE;
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_leaderboard_id_fkey" FOREIGN KEY ("leaderboard_id") REFERENCES "leaderboards"("id") ON DELETE CASCADE;
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE CASCADE;
ALTER TABLE "leaderboards" ADD CONSTRAINT "leaderboards_game_type_id_fkey" FOREIGN KEY ("game_type_id") REFERENCES "game_types"("id");
ALTER TABLE "leaderboards" ADD CONSTRAINT "leaderboards_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "organization_engagement_metrics" ADD CONSTRAINT "organization_engagement_metrics_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE;
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_invited_by_member_id_fkey" FOREIGN KEY ("invited_by_member_id") REFERENCES "organization_members"("id");
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id");
ALTER TABLE "organization_member_departments" ADD CONSTRAINT "organization_member_departments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE;
ALTER TABLE "organization_member_departments" ADD CONSTRAINT "organization_member_departments_organization_member_id_fkey" FOREIGN KEY ("organization_member_id") REFERENCES "organization_members"("id") ON DELETE CASCADE;
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_invited_by_member_id_fkey" FOREIGN KEY ("invited_by_member_id") REFERENCES "organization_members"("id");
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id");
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id");
ALTER TABLE "participants" ADD CONSTRAINT "participants_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE;
ALTER TABLE "participants" ADD CONSTRAINT "participants_invited_by_member_id_fkey" FOREIGN KEY ("invited_by_member_id") REFERENCES "organization_members"("id");
ALTER TABLE "participants" ADD CONSTRAINT "participants_organization_member_id_fkey" FOREIGN KEY ("organization_member_id") REFERENCES "organization_members"("id");
ALTER TABLE "post_reactions" ADD CONSTRAINT "post_reactions_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE CASCADE;
ALTER TABLE "post_reactions" ADD CONSTRAINT "post_reactions_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "activity_posts"("id") ON DELETE CASCADE;
ALTER TABLE "posts_tags" ADD CONSTRAINT "posts_tags_created_by_member_id_fkey" FOREIGN KEY ("created_by_member_id") REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "posts_tags" ADD CONSTRAINT "posts_tags_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "activity_posts"("id") ON DELETE CASCADE;
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_game_type_id_fkey" FOREIGN KEY ("game_type_id") REFERENCES "game_types"("id") ON DELETE CASCADE;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE;
ALTER TABLE "strategic_notes" ADD CONSTRAINT "strategic_notes_game_session_id_fkey" FOREIGN KEY ("game_session_id") REFERENCES "game_sessions"("id") ON DELETE CASCADE;
ALTER TABLE "strategic_notes" ADD CONSTRAINT "strategic_notes_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE CASCADE;
ALTER TABLE "strategic_roles" ADD CONSTRAINT "strategic_roles_game_session_id_fkey" FOREIGN KEY ("game_session_id") REFERENCES "game_sessions"("id") ON DELETE CASCADE;
ALTER TABLE "strategic_roles" ADD CONSTRAINT "strategic_roles_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE CASCADE;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;
ALTER TABLE "user_engagement_metrics" ADD CONSTRAINT "user_engagement_metrics_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "win_categories" ADD CONSTRAINT "win_categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;
CREATE MATERIALIZED VIEW "admin_stats_cache" TABLESPACE public AS (SELECT ( SELECT count(*) AS count FROM users) AS total_users, ( SELECT count(*) AS count FROM organizations) AS total_organizations, ( SELECT count(*) AS count FROM events) AS total_events, ( SELECT count(*) AS count FROM game_sessions) AS total_game_sessions, ( SELECT count(DISTINCT user_sessions.user_id) AS count FROM user_sessions WHERE user_sessions.created_at > (now() - '30 days'::interval)) AS active_users_30d, ( SELECT count(*) AS count FROM users WHERE users.created_at >= CURRENT_DATE) AS new_users_today, ( SELECT count(*) AS count FROM organizations WHERE organizations.created_at >= CURRENT_DATE) AS new_orgs_today, ( SELECT count(*) AS count FROM game_sessions gs JOIN game_types gt ON gs.game_type_id = gt.id WHERE gt.key::text = 'two-truths'::text AND gs.started_at >= CURRENT_DATE) AS two_truths_sessions_today, ( SELECT count(*) AS count FROM game_sessions gs JOIN game_types gt ON gs.game_type_id = gt.id WHERE gt.key::text = 'coffee-roulette'::text AND gs.started_at >= CURRENT_DATE) AS coffee_roulette_sessions_today, ( SELECT count(*) AS count FROM game_sessions gs JOIN game_types gt ON gs.game_type_id = gt.id WHERE gt.key::text = 'wins-of-week'::text AND gs.started_at >= CURRENT_DATE) AS wins_of_week_sessions_today, ( SELECT count(*) AS count FROM game_sessions gs JOIN game_types gt ON gs.game_type_id = gt.id WHERE gt.key::text = 'strategic-escape'::text AND gs.started_at >= CURRENT_DATE) AS strategic_escape_sessions_today, ( SELECT count(*) AS count FROM game_sessions gs JOIN game_types gt ON gs.game_type_id = gt.id WHERE gt.key::text = 'trivia'::text AND gs.started_at >= CURRENT_DATE) AS trivia_sessions_today, ( SELECT count(*) AS count FROM game_sessions gs JOIN game_types gt ON gs.game_type_id = gt.id WHERE gt.key::text = 'scavenger-hunt'::text AND gs.started_at >= CURRENT_DATE) AS scavenger_hunt_sessions_today, ( SELECT count(*) AS count FROM game_sessions gs JOIN game_types gt ON gs.game_type_id = gt.id WHERE gt.key::text = 'gratitude'::text AND gs.started_at >= CURRENT_DATE) AS gratitude_sessions_today, now() AS last_updated);
CREATE UNIQUE INDEX idx_admin_stats_cache_unique ON admin_stats_cache(last_updated);
CREATE VIEW "v_posts_with_tags" TABLESPACE public AS (SELECT p.id, p.event_id, p.author_participant_id, p.content, p.created_at, p.category, p.tags, COALESCE(array_agg(pt.tag) FILTER (WHERE pt.tag IS NOT NULL), ARRAY[]::text[]) AS post_tags FROM activity_posts p LEFT JOIN posts_tags pt ON p.id = pt.post_id GROUP BY p.id);