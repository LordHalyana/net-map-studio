CREATE TABLE `field_provenance` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`field` text NOT NULL,
	`source_type` text NOT NULL,
	`evidence_id` text,
	`import_job_id` text,
	`observation_id` text,
	`confidence` real NOT NULL,
	`parser_version` text NOT NULL,
	`status` text NOT NULL,
	`observed_value` text NOT NULL,
	`observed_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `flows` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source` text NOT NULL,
	`destination` text NOT NULL,
	`protocol` text NOT NULL,
	`port` integer,
	`service_id` text,
	`first_seen` text NOT NULL,
	`last_seen` text NOT NULL,
	`observation_count` integer NOT NULL,
	`confidence` real NOT NULL,
	`lifecycle_state` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `identities` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`scope` text NOT NULL,
	`name` text NOT NULL,
	`domain` text NOT NULL,
	`kind` text NOT NULL,
	`device_id` text,
	`lifecycle_state` text NOT NULL,
	`notes` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `role_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`identity_id` text NOT NULL,
	`device_id` text,
	`privilege` text NOT NULL,
	`detail` text NOT NULL,
	`lifecycle_state` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`identity_id`) REFERENCES `identities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `devices` ADD `os` text DEFAULT '' NOT NULL;