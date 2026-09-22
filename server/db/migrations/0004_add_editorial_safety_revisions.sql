CREATE TABLE `document_revision` (
	`id` text PRIMARY KEY NOT NULL,
	`document_kind` text NOT NULL,
	`document_id` text NOT NULL,
	`schema_key` text,
	`revision` integer NOT NULL,
	`action` text NOT NULL,
	`status` text,
	`title` text,
	`schema_version` integer,
	`snapshot_json` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_document_revision_unique` ON `document_revision` (`document_kind`,`document_id`,`revision`);--> statement-breakpoint
CREATE INDEX `idx_document_revision_document` ON `document_revision` (`document_kind`,`document_id`,`revision`);--> statement-breakpoint
CREATE INDEX `idx_document_revision_created_at` ON `document_revision` (`created_at`);--> statement-breakpoint
ALTER TABLE `content` ADD `current_revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `content` ADD `published_by` text;--> statement-breakpoint
ALTER TABLE `content` ADD `transition_at` integer;--> statement-breakpoint
ALTER TABLE `content` ADD `transition_by` text;--> statement-breakpoint
ALTER TABLE `content` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `content` ADD `deleted_by` text;--> statement-breakpoint
ALTER TABLE `content` ADD `updated_by` text;--> statement-breakpoint
ALTER TABLE `page` ADD `current_revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `page` ADD `published_by` text;--> statement-breakpoint
ALTER TABLE `page` ADD `transition_at` integer;--> statement-breakpoint
ALTER TABLE `page` ADD `transition_by` text;--> statement-breakpoint
ALTER TABLE `page` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `page` ADD `deleted_by` text;--> statement-breakpoint
ALTER TABLE `page` ADD `updated_by` text;--> statement-breakpoint
ALTER TABLE `schema_draft` ADD `current_revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `schema_draft` ADD `updated_by` text;--> statement-breakpoint
ALTER TABLE `schema_role` ADD `can_publish` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `schema_role` ADD `can_archive` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `schema_role` ADD `can_delete` integer DEFAULT false NOT NULL;--> statement-breakpoint
INSERT INTO `document_revision` (
	`id`, `document_kind`, `document_id`, `schema_key`, `revision`, `action`, `status`,
	`schema_version`, `snapshot_json`, `created_by`, `created_at`
)
SELECT
	'backfill-content-' || `id`, 'content', `id`, `schema_key`, 1, 'backfill', `status`,
	`schema_version`, `content_json`, COALESCE(`updated_by`, `created_by`), `updated_at`
FROM `content`;--> statement-breakpoint
INSERT INTO `document_revision` (
	`id`, `document_kind`, `document_id`, `revision`, `action`, `status`, `title`,
	`snapshot_json`, `created_by`, `created_at`
)
SELECT
	'backfill-page-' || `id`, 'page', `id`, 1, 'backfill', `status`, `title`,
	`content_json`, COALESCE(`updated_by`, `created_by`), `updated_at`
FROM `page`;--> statement-breakpoint
INSERT INTO `document_revision` (
	`id`, `document_kind`, `document_id`, `schema_key`, `revision`, `action`, `title`,
	`snapshot_json`, `created_by`, `created_at`
)
SELECT
	'backfill-schema-draft-' || `schema_key`, 'schema-draft', `schema_key`, `schema_key`, 1,
	'backfill', `title`, `ast_json`, `updated_by`, `updated_at`
FROM `schema_draft`;
