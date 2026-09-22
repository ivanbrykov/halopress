CREATE TABLE `installation` (
	`key` text PRIMARY KEY NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`owner` text,
	`lease_token` text,
	`lease_expires_at` integer,
	`completed_at` integer,
	`updated_at` integer NOT NULL,
	`last_error` text
);
--> statement-breakpoint
INSERT INTO `installation` (
	`key`,
	`state`,
	`owner`,
	`lease_token`,
	`lease_expires_at`,
	`completed_at`,
	`updated_at`,
	`last_error`
)
SELECT
	'singleton',
	'complete',
	COALESCE('user:' || (SELECT `id` FROM `user` WHERE `role_key` = 'admin' LIMIT 1), 'legacy:migration'),
	NULL,
	NULL,
	unixepoch(),
	unixepoch(),
	NULL
WHERE EXISTS (SELECT 1 FROM `user` LIMIT 1)
	AND EXISTS (SELECT 1 FROM `user_role` LIMIT 1);
