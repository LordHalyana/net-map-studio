CREATE TABLE `host_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`device_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`path` text,
	`command` text NOT NULL,
	`persistence_kind` text,
	`sha256` text,
	`publisher` text NOT NULL,
	`version` text NOT NULL,
	`remote_access` integer NOT NULL,
	`confidence` real NOT NULL,
	`lifecycle_state` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
