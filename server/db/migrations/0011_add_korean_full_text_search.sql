CREATE TABLE `full_text_chunk` (
	`index_generation` text NOT NULL,
	`content_id` text NOT NULL,
	`schema_key` text NOT NULL,
	`schema_version` integer NOT NULL,
	`field_id` text NOT NULL,
	`published_revision_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`raw_text` text NOT NULL,
	`morph_text` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`index_generation`, `chunk_index`)
);
--> statement-breakpoint
CREATE INDEX `idx_full_text_chunk_content` ON `full_text_chunk` (`content_id`,`field_id`,`index_generation`);--> statement-breakpoint
CREATE TABLE `full_text_control` (
	`key` text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	`tokenizer_generation` text NOT NULL,
	`query_epoch` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE VIRTUAL TABLE `full_text_fts` USING fts5(
	`index_generation` UNINDEXED,
	`content_id` UNINDEXED,
	`schema_key` UNINDEXED,
	`schema_version` UNINDEXED,
	`field_id` UNINDEXED,
	`published_revision_id` UNINDEXED,
	`chunk_index` UNINDEXED,
	`raw_text`,
	`morph_text`,
	tokenize = "unicode61 remove_diacritics 0 tokenchars '_-./:@+'"
);
--> statement-breakpoint
CREATE TABLE `full_text_index_state` (
	`content_id` text NOT NULL,
	`schema_key` text NOT NULL,
	`schema_version` integer NOT NULL,
	`field_id` text NOT NULL,
	`published_revision_id` text NOT NULL,
	`tokenizer_generation` text NOT NULL,
	`active_index_generation` text,
	`building_index_generation` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`indexed_chunks` integer DEFAULT 0 NOT NULL,
	`total_chunks` integer,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`updated_at` integer NOT NULL,
	`activated_at` integer,
	PRIMARY KEY(`content_id`, `field_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_full_text_state_schema_status` ON `full_text_index_state` (`schema_key`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_full_text_state_revision` ON `full_text_index_state` (`published_revision_id`,`tokenizer_generation`);--> statement-breakpoint
CREATE TABLE `full_text_job` (
	`id` text PRIMARY KEY NOT NULL,
	`identity_key` text NOT NULL,
	`operation` text NOT NULL,
	`document_kind` text DEFAULT 'content' NOT NULL,
	`document_id` text NOT NULL,
	`schema_key` text,
	`schema_version` integer,
	`field_id` text DEFAULT '*' NOT NULL,
	`target_revision_id` text,
	`tokenizer_generation` text NOT NULL,
	`index_generation` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`checkpoint` integer DEFAULT 0 NOT NULL,
	`total_chunks` integer,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`available_at` integer NOT NULL,
	`lease_expires_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_full_text_job_identity` ON `full_text_job` (`identity_key`);--> statement-breakpoint
CREATE INDEX `idx_full_text_job_dispatch` ON `full_text_job` (`status`,`available_at`,`lease_expires_at`);--> statement-breakpoint
CREATE INDEX `idx_full_text_job_document` ON `full_text_job` (`document_kind`,`document_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_full_text_job_schema` ON `full_text_job` (`schema_key`,`status`,`created_at`);--> statement-breakpoint
ALTER TABLE `search_config` ADD `full_text` integer DEFAULT false NOT NULL;--> statement-breakpoint
INSERT INTO `full_text_control` (
	`key`,
	`tokenizer_generation`,
	`query_epoch`,
	`status`,
	`updated_at`
) VALUES (
	'singleton',
	'contract-1:garu-ko@0.9.11:model-5186b7ccf18bd154:profile-1:nfc',
	1,
	'available',
	0
);
