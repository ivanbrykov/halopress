CREATE TABLE `public_route` (
	`path` text PRIMARY KEY NOT NULL,
	`route_kind` text NOT NULL,
	`document_kind` text NOT NULL,
	`document_id` text NOT NULL,
	`schema_key` text,
	`seo_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_public_route_canonical_document` ON `public_route` (`document_kind`,`document_id`) WHERE "public_route"."route_kind" = 'canonical';--> statement-breakpoint
CREATE INDEX `idx_public_route_document` ON `public_route` (`document_kind`,`document_id`,`route_kind`);--> statement-breakpoint
CREATE INDEX `idx_public_route_schema` ON `public_route` (`schema_key`,`route_kind`,`path`);--> statement-breakpoint
ALTER TABLE `content` ADD `public_path` text;--> statement-breakpoint
ALTER TABLE `content` ADD `seo_json` text;--> statement-breakpoint
ALTER TABLE `page` ADD `public_path` text;--> statement-breakpoint
ALTER TABLE `page` ADD `seo_json` text;--> statement-breakpoint
INSERT INTO `public_route` (`path`, `route_kind`, `document_kind`, `document_id`, `schema_key`, `seo_json`, `created_at`, `updated_at`)
SELECT '/p/' || lower(`id`), 'canonical', 'page', `id`, NULL, NULL,
	coalesce(`first_published_at`, `published_at`, `created_at`),
	coalesce(`published_at`, `updated_at`)
FROM `page`
WHERE `published_revision_id` IS NOT NULL
	AND `status` <> 'deleted';--> statement-breakpoint
INSERT INTO `public_route` (`path`, `route_kind`, `document_kind`, `document_id`, `schema_key`, `seo_json`, `created_at`, `updated_at`)
SELECT '/' || lower(`schema_key`), 'canonical', 'schema', `schema_key`, `schema_key`, NULL, `updated_at`, `updated_at`
FROM `schema_active`
WHERE lower(`schema_key`) NOT IN (
	'_desk', '_install', '_ipx', '_nuxt', '_preview', 'account', 'api', 'assets', 'auth',
	'branding', 'cdn-cgi', 'login', 'p', 'signup'
);--> statement-breakpoint
INSERT INTO `public_route` (`path`, `route_kind`, `document_kind`, `document_id`, `schema_key`, `seo_json`, `created_at`, `updated_at`)
SELECT '/' || lower(`schema_key`) || '/' || lower(`id`), 'canonical', 'content', `id`, `schema_key`, NULL,
	coalesce(`first_published_at`, `published_at`, `created_at`),
	coalesce(`published_at`, `updated_at`)
FROM `content`
WHERE `published_revision_id` IS NOT NULL
	AND `status` <> 'deleted'
	AND lower(`schema_key`) NOT IN (
		'_desk', '_install', '_ipx', '_nuxt', '_preview', 'account', 'api', 'assets', 'auth',
		'branding', 'cdn-cgi', 'login', 'p', 'signup'
	);
