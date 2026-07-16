CREATE TABLE `egress_audit_records` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`timestamp` text NOT NULL,
	`provider_id` text NOT NULL,
	`indicator_type` text NOT NULL,
	`query` text NOT NULL,
	`outcome` text NOT NULL,
	`detail` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `egress_settings` (
	`project_id` text PRIMARY KEY NOT NULL,
	`enabled` integer NOT NULL,
	`disclosure_acknowledged_at` text,
	`allowed_indicator_types` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
