CREATE TABLE `site_layout_reference` (
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`slot` text NOT NULL,
	`layout_id` text NOT NULL,
	`label` text NOT NULL,
	`behavior` text DEFAULT 'use-current' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`owner_type`, `owner_id`, `slot`),
	FOREIGN KEY (`layout_id`) REFERENCES `site_layout_resource`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_site_layout_reference_layout` ON `site_layout_reference` (`layout_id`);--> statement-breakpoint
CREATE TABLE `site_layout_resource` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`document_json` text NOT NULL,
	`current_revision` integer DEFAULT 1 NOT NULL,
	`created_by` text,
	`updated_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_site_layout_resource_name_unique` ON `site_layout_resource` (`name_key`);--> statement-breakpoint
CREATE INDEX `idx_site_layout_resource_updated_at` ON `site_layout_resource` (`updated_at`);