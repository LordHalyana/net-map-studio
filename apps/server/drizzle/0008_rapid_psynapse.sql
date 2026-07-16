CREATE TABLE `threat_intel_local_feeds` (
	`project_id` text PRIMARY KEY NOT NULL,
	`entries` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
