CREATE TABLE `external_identity` (
	`provider` text NOT NULL,
	`subject` text NOT NULL,
	`user_id` text NOT NULL,
	`email_at_link` text,
	`email_verified` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer NOT NULL,
	PRIMARY KEY(`provider`, `subject`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_external_identity_user_provider` ON `external_identity` (`user_id`,`provider`);--> statement-breakpoint
CREATE INDEX `idx_external_identity_user` ON `external_identity` (`user_id`);--> statement-breakpoint
CREATE TABLE `membership_invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`email` text NOT NULL,
	`role_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`used_by` text,
	`used_at` integer,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`role_key`) REFERENCES `user_role`(`role_key`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`used_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_membership_invitation_token` ON `membership_invitation` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_membership_invitation_email_status` ON `membership_invitation` (`email`,`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `registration_rate_limit` (
	`bucket_key` text PRIMARY KEY NOT NULL,
	`attempt_count` integer DEFAULT 1 NOT NULL,
	`reset_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_registration_rate_limit_reset` ON `registration_rate_limit` (`reset_at`);--> statement-breakpoint
CREATE TABLE `_halopress_email_normalization_guard` (`email` text PRIMARY KEY);--> statement-breakpoint
INSERT INTO `_halopress_email_normalization_guard` (`email`) SELECT lower(trim(`email`)) FROM `user`;--> statement-breakpoint
DROP TABLE `_halopress_email_normalization_guard`;--> statement-breakpoint
UPDATE `user` SET `email` = lower(trim(`email`));--> statement-breakpoint
DROP INDEX `idx_user_email`;--> statement-breakpoint
ALTER TABLE `user` ADD `email_verified_at` integer;--> statement-breakpoint
ALTER TABLE `user` ADD `account_type` text DEFAULT 'staff' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_email_unique` ON `user` (`email`);
