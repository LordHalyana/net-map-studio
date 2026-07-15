CREATE TABLE `import_proposals` (
	`import_job_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`change_set_id` text NOT NULL,
	`label` text NOT NULL,
	`operations` text NOT NULL,
	`entity_ids` text NOT NULL,
	`conflicts` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`import_job_id`) REFERENCES `import_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
