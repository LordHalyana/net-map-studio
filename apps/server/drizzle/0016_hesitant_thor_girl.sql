CREATE TABLE `secret_matches` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`masked` text NOT NULL,
	`evidence_id` text NOT NULL,
	`offset` integer NOT NULL,
	`length` integer NOT NULL,
	`revealed` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
