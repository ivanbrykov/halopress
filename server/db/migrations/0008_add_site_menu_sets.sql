CREATE TABLE `site_menu_reference` (
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`slot` text NOT NULL,
	`menu_set_id` text NOT NULL,
	`label` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`owner_type`, `owner_id`, `slot`),
	FOREIGN KEY (`menu_set_id`) REFERENCES `site_menu_set`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_site_menu_reference_menu` ON `site_menu_reference` (`menu_set_id`);--> statement-breakpoint
CREATE TABLE `site_menu_set` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`document_json` text NOT NULL,
	`bootstrap_owned` integer DEFAULT false NOT NULL,
	`bootstrap_source_updated_at` integer,
	`created_by` text,
	`updated_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_site_menu_set_name_unique` ON `site_menu_set` (`name_key`);--> statement-breakpoint
CREATE INDEX `idx_site_menu_set_updated_at` ON `site_menu_set` (`updated_at`);