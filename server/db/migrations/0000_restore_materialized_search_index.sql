CREATE TABLE `asset` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`object_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text,
	`width` integer,
	`height` integer,
	`duration_ms` integer,
	`created_by` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_asset_created_at` ON `asset` (`created_at`);--> statement-breakpoint
CREATE TABLE `content` (
	`id` text PRIMARY KEY NOT NULL,
	`schema_key` text NOT NULL,
	`schema_version` integer NOT NULL,
	`status` text NOT NULL,
	`content_json` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_content_schema_updated` ON `content` (`schema_key`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_content_status` ON `content` (`schema_key`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `content_listing` (
	`content_id` text PRIMARY KEY NOT NULL,
	`schema_key` text NOT NULL,
	`schema_version` integer NOT NULL,
	`title` text,
	`description` text,
	`image` text,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`content_id`) REFERENCES `content`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`schema_key`,`schema_version`) REFERENCES `schema`(`schema_key`,`version`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_content_listing_schema_updated` ON `content_listing` (`schema_key`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_content_listing_status_updated` ON `content_listing` (`schema_key`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_content_listing_status_created` ON `content_listing` (`schema_key`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_content_listing_content` ON `content_listing` (`content_id`);--> statement-breakpoint
CREATE TABLE `content_ref` (
	`content_id` text NOT NULL,
	`field_path` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_schema_key` text,
	`target_id` text NOT NULL,
	PRIMARY KEY(`content_id`, `field_path`, `target_kind`, `target_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_content_ref_target` ON `content_ref` (`target_kind`,`target_id`);--> statement-breakpoint
CREATE INDEX `idx_content_ref_content` ON `content_ref` (`content_id`);--> statement-breakpoint
CREATE TABLE `content_ref_list` (
	`owner_content_id` text NOT NULL,
	`field_key` text NOT NULL,
	`position` integer NOT NULL,
	`item_kind` text NOT NULL,
	`item_schema_key` text,
	`item_id` text,
	`asset_id` text,
	`meta_json` text,
	PRIMARY KEY(`owner_content_id`, `field_key`, `position`)
);
--> statement-breakpoint
CREATE INDEX `idx_content_ref_list_owner` ON `content_ref_list` (`owner_content_id`,`field_key`);--> statement-breakpoint
CREATE TABLE `content_search_data` (
	`content_id` text NOT NULL,
	`field_id` text NOT NULL,
	`data_type` text NOT NULL,
	`text` text,
	`value` real,
	PRIMARY KEY(`content_id`, `field_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_filter_content_search_text` ON `content_search_data` (`field_id`,`data_type`,`text`,`content_id`);--> statement-breakpoint
CREATE INDEX `idx_filter_content_search_value` ON `content_search_data` (`field_id`,`data_type`,`value`,`content_id`);--> statement-breakpoint
CREATE TABLE `page` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`content_json` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_page_status` ON `page` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_page_updated_at` ON `page` (`updated_at`);--> statement-breakpoint
CREATE TABLE `schema` (
	`schema_key` text NOT NULL,
	`version` integer NOT NULL,
	`title` text,
	`ast_json` text NOT NULL,
	`json_schema` text NOT NULL,
	`ui_schema` text,
	`registry_json` text,
	`diff_json` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`note` text,
	PRIMARY KEY(`schema_key`, `version`)
);
--> statement-breakpoint
CREATE INDEX `idx_schema_created_at` ON `schema` (`created_at`);--> statement-breakpoint
CREATE TABLE `schema_active` (
	`schema_key` text PRIMARY KEY NOT NULL,
	`active_version` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `schema_draft` (
	`schema_key` text PRIMARY KEY NOT NULL,
	`title` text,
	`ast_json` text NOT NULL,
	`updated_at` integer NOT NULL,
	`locked_by` text,
	`lock_expires_at` integer
);
--> statement-breakpoint
CREATE TABLE `schema_role` (
	`schema_key` text NOT NULL,
	`role_key` text NOT NULL,
	`can_read` integer DEFAULT false NOT NULL,
	`can_write` integer DEFAULT false NOT NULL,
	`can_admin` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`schema_key`, `role_key`),
	FOREIGN KEY (`role_key`) REFERENCES `user_role`(`role_key`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_schema_role_schema` ON `schema_role` (`schema_key`);--> statement-breakpoint
CREATE INDEX `idx_schema_role_role` ON `schema_role` (`role_key`);--> statement-breakpoint
CREATE TABLE `search_config` (
	`schema_key` text NOT NULL,
	`field_id` text NOT NULL,
	`field_key` text NOT NULL,
	`kind` text NOT NULL,
	`search_mode` text DEFAULT 'off' NOT NULL,
	`filterable` integer DEFAULT false NOT NULL,
	`sortable` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`schema_key`, `field_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_search_config_schema` ON `search_config` (`schema_key`);--> statement-breakpoint
CREATE INDEX `idx_search_config_key` ON `search_config` (`schema_key`,`field_key`);--> statement-breakpoint
CREATE TABLE `settings` (
	`scope` text DEFAULT 'global' NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`value_type` text DEFAULT 'string' NOT NULL,
	`is_encrypted` integer DEFAULT false NOT NULL,
	`group_key` text,
	`updated_by` text,
	`updated_at` integer NOT NULL,
	`note` text,
	PRIMARY KEY(`scope`, `key`)
);
--> statement-breakpoint
CREATE INDEX `idx_settings_key` ON `settings` (`key`);--> statement-breakpoint
CREATE INDEX `idx_settings_group` ON `settings` (`group_key`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`role_key` text DEFAULT 'user' NOT NULL,
	`password_hash` text,
	`password_salt` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`role_key`) REFERENCES `user_role`(`role_key`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_user_email` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `user_role` (
	`role_key` text PRIMARY KEY NOT NULL,
	`title` text,
	`level` integer DEFAULT 50 NOT NULL
);
