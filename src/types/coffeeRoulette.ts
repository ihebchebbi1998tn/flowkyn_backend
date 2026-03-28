/**
 * Coffee Roulette Dynamic Configuration Types
 * Defines all data structures for managing dynamic topics and questions
 */

// ─── Enums ───
export enum TopicSelectionStrategy {
  RANDOM = 'random',
  SEQUENTIAL = 'sequential',
  WEIGHTED = 'weighted',
}

export enum QuestionSelectionStrategy {
  RANDOM = 'random',
  SEQUENTIAL = 'sequential',
  ALL = 'all', // Return all questions for the session
}

export enum QuestionType {
  GENERAL = 'general', // Applies to all topics
  TOPIC_SPECIFIC = 'topic-specific', // Only for assigned topics
}

export enum DifficultyLevel {
  EASY = 'easy',
  MODERATE = 'moderate',
  CHALLENGING = 'challenging',
}

export enum AuditAction {
  CREATED = 'created',
  UPDATED = 'updated',
  DELETED = 'deleted',
}

// ─── Database Models ───

export interface CoffeeRouletteConfig {
  id: string;
  event_id: string;
  duration_minutes: number;
  max_prompts: number;
  topic_selection_strategy: TopicSelectionStrategy;
  question_selection_strategy: QuestionSelectionStrategy;
  allow_general_questions: boolean;
  shuffle_on_repeat: boolean;
  created_by_member_id: string;
  created_at: Date;
  updated_at: Date;
}

export interface CoffeeRouletteTopic {
  id: string;
  config_id: string;
  title: string;
  description?: string;
  icon?: string;
  weight: number;
  display_order: number;
  is_active: boolean;
  created_by_member_id: string;
  created_at: Date;
  updated_at: Date;
}

export interface CoffeeRouletteQuestion {
  id: string;
  config_id: string;
  text: string;
  category?: string;
  difficulty: DifficultyLevel;
  question_type: QuestionType;
  weight: number;
  display_order: number;
  is_active: boolean;
  created_by_member_id: string;
  created_at: Date;
  updated_at: Date;
}

export interface CoffeeRouletteTopicQuestion {
  id: string;
  topic_id: string;
  question_id: string;
  display_order: number;
  created_at: Date;
}

export interface CoffeeRoulettePairContext {
  id: string;
  event_id: string;
  participant1_id: string;
  participant2_id: string;
  session_start_time: Date;
  session_end_time?: Date;
  duration_seconds?: number;
  topic_id?: string;
  questions_used: string[];
  questions_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface CoffeeRouletteConfigAudit {
  id: string;
  config_id: string;
  changed_by_member_id: string;
  action: AuditAction;
  entity_type: string;
  entity_id?: string;
  old_values?: Record<string, any>;
  new_values?: Record<string, any>;
  created_at: Date;
}

// ─── Request/Response Types ───

export interface CreateConfigRequest {
  event_id: string;
  duration_minutes?: number;
  max_prompts?: number;
  topic_selection_strategy?: TopicSelectionStrategy;
  question_selection_strategy?: QuestionSelectionStrategy;
  allow_general_questions?: boolean;
  shuffle_on_repeat?: boolean;
}

export interface UpdateConfigRequest {
  duration_minutes?: number;
  max_prompts?: number;
  topic_selection_strategy?: TopicSelectionStrategy;
  question_selection_strategy?: QuestionSelectionStrategy;
  allow_general_questions?: boolean;
  shuffle_on_repeat?: boolean;
}

export interface CreateTopicRequest {
  config_id: string;
  title: string;
  description?: string;
  icon?: string;
  weight?: number;
  display_order?: number;
}

export interface UpdateTopicRequest {
  title?: string;
  description?: string;
  icon?: string;
  weight?: number;
  display_order?: number;
  is_active?: boolean;
}

export interface CreateQuestionRequest {
  config_id: string;
  text: string;
  category?: string;
  difficulty?: DifficultyLevel;
  question_type?: QuestionType;
  weight?: number;
  display_order?: number;
}

export interface UpdateQuestionRequest {
  text?: string;
  category?: string;
  difficulty?: DifficultyLevel;
  question_type?: QuestionType;
  weight?: number;
  display_order?: number;
  is_active?: boolean;
}

export interface AssignQuestionToTopicRequest {
  topic_id: string;
  question_id: string;
  display_order?: number;
}

export interface ReorderQuestionRequest {
  display_order: number;
}

// ─── Selection & Query Types ───

export interface SelectionContext {
  config_id: string;
  topic_id?: string;
  used_indices?: Set<number>; // Track already-used questions for this session
}

export interface SelectedQuestion {
  id: string;
  text: string;
  category?: string;
  difficulty: DifficultyLevel;
}

export interface SelectedTopic {
  id: string;
  title: string;
  description?: string;
  icon?: string;
}

// ─── Statistics & Reporting ───

export interface ConfigStats {
  config_id: string;
  event_id: string;
  total_topics: number;
  active_topics: number;
  total_questions: number;
  active_questions: number;
  general_questions: number;
  topic_specific_questions: number;
  total_pairings: number;
  average_duration_seconds: number;
  last_updated: Date;
}

export interface TopicStats {
  topic_id: string;
  title: string;
  total_questions: number;
  times_selected: number;
  average_difficulty: number;
  last_used?: Date;
}

// ─── API Response Types ───

export interface ConfigResponse {
  success: boolean;
  data?: CoffeeRouletteConfig;
  error?: string;
}

export interface TopicsResponse {
  success: boolean;
  data?: CoffeeRouletteTopic[];
  count?: number;
  error?: string;
}

export interface QuestionsResponse {
  success: boolean;
  data?: CoffeeRouletteQuestion[];
  count?: number;
  error?: string;
}

export interface TopicDetailsResponse {
  success: boolean;
  data?: CoffeeRouletteTopic & {
    questions: CoffeeRouletteQuestion[];
  };
  error?: string;
}
