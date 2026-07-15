ALTER TABLE `change_sets` ADD `review_status` text;--> statement-breakpoint
ALTER TABLE `change_sets` ADD `reviewed_at` text;--> statement-breakpoint
ALTER TABLE `change_sets` ADD `review_note` text DEFAULT '' NOT NULL;