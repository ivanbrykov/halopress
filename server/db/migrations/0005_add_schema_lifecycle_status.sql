ALTER TABLE `schema_active` ADD `status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `schema_active` ADD `deactivated_at` integer;--> statement-breakpoint
ALTER TABLE `schema_active` ADD `deactivated_by` text;--> statement-breakpoint
ALTER TABLE `schema_active` ADD `reactivated_at` integer;--> statement-breakpoint
ALTER TABLE `schema_active` ADD `reactivated_by` text;--> statement-breakpoint
CREATE INDEX `idx_schema_active_status` ON `schema_active` (`status`,`schema_key`);