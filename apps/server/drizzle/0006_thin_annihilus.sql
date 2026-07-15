CREATE TABLE `baselines` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`scope` text NOT NULL,
	`version` integer NOT NULL,
	`expected_services` text NOT NULL,
	`expected_traffic` text NOT NULL,
	`lifecycle_state` text NOT NULL,
	`notes` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
