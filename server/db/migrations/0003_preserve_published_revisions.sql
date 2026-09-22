CREATE TABLE `document_asset_ref` (
	`document_kind` text NOT NULL,
	`document_id` text NOT NULL,
	`projection_scope` text NOT NULL,
	`asset_id` text NOT NULL,
	PRIMARY KEY(`document_kind`, `document_id`, `projection_scope`, `asset_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_document_asset_ref_asset` ON `document_asset_ref` (`asset_id`,`projection_scope`);--> statement-breakpoint
CREATE TABLE `publication_revision` (
	`id` text PRIMARY KEY NOT NULL,
	`document_kind` text NOT NULL,
	`document_id` text NOT NULL,
	`schema_key` text,
	`schema_version` integer,
	`title` text,
	`content_json` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_publication_revision_document` ON `publication_revision` (`document_kind`,`document_id`,`created_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_content_listing` (
	`content_id` text NOT NULL,
	`projection_scope` text DEFAULT 'working' NOT NULL,
	`schema_key` text NOT NULL,
	`schema_version` integer NOT NULL,
	`title` text,
	`description` text,
	`image` text,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`content_id`, `projection_scope`),
	FOREIGN KEY (`content_id`) REFERENCES `content`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`schema_key`,`schema_version`) REFERENCES `schema`(`schema_key`,`version`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_content_listing`("content_id", "projection_scope", "schema_key", "schema_version", "title", "description", "image", "status", "created_at", "updated_at") SELECT "content_id", 'working', "schema_key", "schema_version", "title", "description", "image", "status", "created_at", "updated_at" FROM `content_listing`;--> statement-breakpoint
DROP TABLE `content_listing`;--> statement-breakpoint
ALTER TABLE `__new_content_listing` RENAME TO `content_listing`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_content_listing_schema_updated` ON `content_listing` (`projection_scope`,`schema_key`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_content_listing_status_updated` ON `content_listing` (`projection_scope`,`schema_key`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_content_listing_status_created` ON `content_listing` (`projection_scope`,`schema_key`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_content_listing_content` ON `content_listing` (`content_id`,`projection_scope`);--> statement-breakpoint
CREATE TABLE `__new_content_ref` (
	`content_id` text NOT NULL,
	`projection_scope` text DEFAULT 'working' NOT NULL,
	`field_path` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_schema_key` text,
	`target_id` text NOT NULL,
	PRIMARY KEY(`content_id`, `projection_scope`, `field_path`, `target_kind`, `target_id`)
);
--> statement-breakpoint
INSERT INTO `__new_content_ref`("content_id", "projection_scope", "field_path", "target_kind", "target_schema_key", "target_id") SELECT "content_id", 'working', "field_path", "target_kind", "target_schema_key", "target_id" FROM `content_ref`;--> statement-breakpoint
DROP TABLE `content_ref`;--> statement-breakpoint
ALTER TABLE `__new_content_ref` RENAME TO `content_ref`;--> statement-breakpoint
CREATE INDEX `idx_content_ref_target` ON `content_ref` (`projection_scope`,`target_kind`,`target_id`);--> statement-breakpoint
CREATE INDEX `idx_content_ref_content` ON `content_ref` (`content_id`,`projection_scope`);--> statement-breakpoint
CREATE TABLE `__new_content_ref_list` (
	`owner_content_id` text NOT NULL,
	`projection_scope` text DEFAULT 'working' NOT NULL,
	`field_key` text NOT NULL,
	`position` integer NOT NULL,
	`item_kind` text NOT NULL,
	`item_schema_key` text,
	`item_id` text,
	`asset_id` text,
	`meta_json` text,
	PRIMARY KEY(`owner_content_id`, `projection_scope`, `field_key`, `position`)
);
--> statement-breakpoint
INSERT INTO `__new_content_ref_list`("owner_content_id", "projection_scope", "field_key", "position", "item_kind", "item_schema_key", "item_id", "asset_id", "meta_json") SELECT "owner_content_id", 'working', "field_key", "position", "item_kind", "item_schema_key", "item_id", "asset_id", "meta_json" FROM `content_ref_list`;--> statement-breakpoint
DROP TABLE `content_ref_list`;--> statement-breakpoint
ALTER TABLE `__new_content_ref_list` RENAME TO `content_ref_list`;--> statement-breakpoint
CREATE INDEX `idx_content_ref_list_owner` ON `content_ref_list` (`owner_content_id`,`projection_scope`,`field_key`);--> statement-breakpoint
CREATE TABLE `__new_content_search_data` (
	`content_id` text NOT NULL,
	`projection_scope` text DEFAULT 'working' NOT NULL,
	`field_id` text NOT NULL,
	`data_type` text NOT NULL,
	`text` text,
	`value` real,
	PRIMARY KEY(`content_id`, `projection_scope`, `field_id`)
);
--> statement-breakpoint
INSERT INTO `__new_content_search_data`("content_id", "projection_scope", "field_id", "data_type", "text", "value") SELECT "content_id", 'working', "field_id", "data_type", "text", "value" FROM `content_search_data`;--> statement-breakpoint
DROP TABLE `content_search_data`;--> statement-breakpoint
ALTER TABLE `__new_content_search_data` RENAME TO `content_search_data`;--> statement-breakpoint
CREATE INDEX `idx_filter_content_search_text` ON `content_search_data` (`projection_scope`,`field_id`,`data_type`,`text`,`content_id`);--> statement-breakpoint
CREATE INDEX `idx_filter_content_search_value` ON `content_search_data` (`projection_scope`,`field_id`,`data_type`,`value`,`content_id`);--> statement-breakpoint
ALTER TABLE `content` ADD `published_revision_id` text;--> statement-breakpoint
ALTER TABLE `content` ADD `first_published_at` integer;--> statement-breakpoint
ALTER TABLE `content` ADD `published_at` integer;--> statement-breakpoint
ALTER TABLE `page` ADD `published_revision_id` text;--> statement-breakpoint
ALTER TABLE `page` ADD `first_published_at` integer;--> statement-breakpoint
ALTER TABLE `page` ADD `published_at` integer;--> statement-breakpoint

INSERT INTO `publication_revision` (
	`id`, `document_kind`, `document_id`, `schema_key`, `schema_version`, `title`,
	`content_json`, `created_by`, `created_at`
)
SELECT
	'legacy:content:' || `id`, 'content', `id`, `schema_key`, `schema_version`, NULL,
	`content_json`, `created_by`, `updated_at`
FROM `content`
WHERE `status` = 'published';--> statement-breakpoint

INSERT INTO `publication_revision` (
	`id`, `document_kind`, `document_id`, `schema_key`, `schema_version`, `title`,
	`content_json`, `created_by`, `created_at`
)
SELECT
	'legacy:page:' || `id`, 'page', `id`, NULL, NULL, `title`,
	`content_json`, `created_by`, `updated_at`
FROM `page`
WHERE `status` = 'published';--> statement-breakpoint

UPDATE `content`
SET
	`published_revision_id` = 'legacy:content:' || `id`,
	`first_published_at` = `updated_at`,
	`published_at` = `updated_at`
WHERE `status` = 'published';--> statement-breakpoint

UPDATE `page`
SET
	`published_revision_id` = 'legacy:page:' || `id`,
	`first_published_at` = `updated_at`,
	`published_at` = `updated_at`
WHERE `status` = 'published';--> statement-breakpoint

INSERT INTO `content_listing` (
	`content_id`, `projection_scope`, `schema_key`, `schema_version`, `title`,
	`description`, `image`, `status`, `created_at`, `updated_at`
)
SELECT
	l.`content_id`, 'published', l.`schema_key`, l.`schema_version`, l.`title`,
	l.`description`, l.`image`, 'published', l.`created_at`, l.`updated_at`
FROM `content_listing` l
INNER JOIN `content` c ON c.`id` = l.`content_id`
WHERE l.`projection_scope` = 'working' AND c.`published_revision_id` IS NOT NULL;--> statement-breakpoint

INSERT INTO `content_search_data` (
	`content_id`, `projection_scope`, `field_id`, `data_type`, `text`, `value`
)
SELECT s.`content_id`, 'published', s.`field_id`, s.`data_type`, s.`text`, s.`value`
FROM `content_search_data` s
INNER JOIN `content` c ON c.`id` = s.`content_id`
WHERE s.`projection_scope` = 'working' AND c.`published_revision_id` IS NOT NULL;--> statement-breakpoint

INSERT INTO `content_ref` (
	`content_id`, `projection_scope`, `field_path`, `target_kind`, `target_schema_key`, `target_id`
)
SELECT r.`content_id`, 'published', r.`field_path`, r.`target_kind`, r.`target_schema_key`, r.`target_id`
FROM `content_ref` r
INNER JOIN `content` c ON c.`id` = r.`content_id`
WHERE r.`projection_scope` = 'working' AND c.`published_revision_id` IS NOT NULL;--> statement-breakpoint

INSERT INTO `content_ref_list` (
	`owner_content_id`, `projection_scope`, `field_key`, `position`, `item_kind`,
	`item_schema_key`, `item_id`, `asset_id`, `meta_json`
)
SELECT
	r.`owner_content_id`, 'published', r.`field_key`, r.`position`, r.`item_kind`,
	r.`item_schema_key`, r.`item_id`, r.`asset_id`, r.`meta_json`
FROM `content_ref_list` r
INNER JOIN `content` c ON c.`id` = r.`owner_content_id`
WHERE r.`projection_scope` = 'working' AND c.`published_revision_id` IS NOT NULL;--> statement-breakpoint

INSERT OR IGNORE INTO `document_asset_ref` (`document_kind`, `document_id`, `projection_scope`, `asset_id`)
SELECT 'content', `content_id`, `projection_scope`, `target_id`
FROM `content_ref`
WHERE `target_kind` = 'asset';--> statement-breakpoint

WITH RECURSIVE
`asset_urls` (`document_kind`, `document_id`, `projection_scope`, `value`) AS (
	SELECT 'content', c.`id`, 'working', j.`value`
	FROM `content` c, json_tree(c.`content_json`) j
	WHERE j.`type` = 'text'
	UNION ALL
	SELECT 'content', c.`id`, 'published', j.`value`
	FROM `content` c, json_tree(c.`content_json`) j
	WHERE c.`published_revision_id` IS NOT NULL AND j.`type` = 'text'
	UNION ALL
	SELECT 'page', p.`id`, 'working', j.`value`
	FROM `page` p, json_tree(p.`content_json`) j
	WHERE j.`type` = 'text'
	UNION ALL
	SELECT 'page', p.`id`, 'published', j.`value`
	FROM `page` p, json_tree(p.`content_json`) j
	WHERE p.`published_revision_id` IS NOT NULL AND j.`type` = 'text'
),
`asset_scans` (`document_kind`, `document_id`, `projection_scope`, `remaining`) AS (
	SELECT `document_kind`, `document_id`, `projection_scope`, `value`
	FROM `asset_urls`
	UNION ALL
	SELECT
		`document_kind`, `document_id`, `projection_scope`,
		substr(`remaining`, instr(`remaining`, '/assets/') + 8)
	FROM `asset_scans`
	WHERE instr(`remaining`, '/assets/') > 0
),
`asset_paths` (`document_kind`, `document_id`, `projection_scope`, `tail`, `raw_position`) AS (
	SELECT
		`document_kind`, `document_id`, `projection_scope`,
		substr(`remaining`, instr(`remaining`, '/assets/') + 8),
		instr(substr(`remaining`, instr(`remaining`, '/assets/') + 8), '/raw')
	FROM `asset_scans`
	WHERE instr(`remaining`, '/assets/') > 0
		AND (
			instr(`remaining`, '/assets/') = 1
			OR substr(`remaining`, instr(`remaining`, '/assets/') - 1, 1) IN ('"', '(', ' ')
			OR substr(`remaining`, instr(`remaining`, '/assets/') - 1, 1) = char(39)
			OR unicode(substr(`remaining`, instr(`remaining`, '/assets/') - 1, 1)) BETWEEN 9 AND 13
		)
),
`asset_candidates` (`document_kind`, `document_id`, `projection_scope`, `encoded_id`) AS (
	SELECT
		`document_kind`, `document_id`, `projection_scope`, substr(`tail`, 1, `raw_position` - 1)
	FROM `asset_paths`
	WHERE `raw_position` > 1
),
`decoded_ids` (
	`document_kind`, `document_id`, `projection_scope`, `encoded_id`, `position`, `hex_value`, `valid`
) AS (
	SELECT `document_kind`, `document_id`, `projection_scope`, `encoded_id`, 1, '', 1
	FROM `asset_candidates`
	UNION ALL
	SELECT
		`document_kind`, `document_id`, `projection_scope`, `encoded_id`,
		`position` + CASE
			WHEN substr(`encoded_id`, `position`, 1) = '%'
				AND instr('0123456789ABCDEF', upper(substr(`encoded_id`, `position` + 1, 1))) > 0
				AND instr('0123456789ABCDEF', upper(substr(`encoded_id`, `position` + 2, 1))) > 0
			THEN 3 ELSE 1 END,
		`hex_value` || CASE
			WHEN substr(`encoded_id`, `position`, 1) = '%'
				AND instr('0123456789ABCDEF', upper(substr(`encoded_id`, `position` + 1, 1))) > 0
				AND instr('0123456789ABCDEF', upper(substr(`encoded_id`, `position` + 2, 1))) > 0
			THEN substr(`encoded_id`, `position` + 1, 2)
			ELSE hex(substr(`encoded_id`, `position`, 1)) END,
		`valid` AND NOT (
			substr(`encoded_id`, `position`, 1) = '%'
			AND (
				instr('0123456789ABCDEF', upper(substr(`encoded_id`, `position` + 1, 1))) = 0
				OR instr('0123456789ABCDEF', upper(substr(`encoded_id`, `position` + 2, 1))) = 0
			)
		)
	FROM `decoded_ids`
	WHERE `position` <= length(`encoded_id`)
),
`canonical_ids` (`document_kind`, `document_id`, `projection_scope`, `asset_id`) AS (
	SELECT
		`document_kind`, `document_id`, `projection_scope`,
		CASE WHEN `valid` THEN CAST(unhex(`hex_value`) AS TEXT) ELSE `encoded_id` END
	FROM `decoded_ids`
	WHERE `position` > length(`encoded_id`)
)
INSERT OR IGNORE INTO `document_asset_ref` (`document_kind`, `document_id`, `projection_scope`, `asset_id`)
SELECT c.`document_kind`, c.`document_id`, c.`projection_scope`, a.`id`
FROM `canonical_ids` c
INNER JOIN `asset` a ON a.`id` = c.`asset_id`;
