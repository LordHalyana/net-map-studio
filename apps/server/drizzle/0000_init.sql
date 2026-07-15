CREATE TABLE `addresses` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`interface_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`lifecycle_state` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`interface_id`) REFERENCES `interfaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `change_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`label` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`zone_id` text,
	`name` text NOT NULL,
	`device_type` text NOT NULL,
	`custom_type_label` text NOT NULL,
	`custom_icon_key` text NOT NULL,
	`vendor` text NOT NULL,
	`model` text NOT NULL,
	`serial_number` text NOT NULL,
	`asset_tag` text NOT NULL,
	`location` text NOT NULL,
	`criticality` text NOT NULL,
	`status` text NOT NULL,
	`lifecycle_state` text NOT NULL,
	`tags` text NOT NULL,
	`notes` text NOT NULL,
	`position` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`zone_id`) REFERENCES `zones`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `interfaces` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`device_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`network_id` text,
	`lifecycle_state` text NOT NULL,
	`notes` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`network_id`) REFERENCES `networks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `links` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source` text NOT NULL,
	`target` text NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`lifecycle_state` text NOT NULL,
	`notes` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `networks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`vlan_id` integer,
	`cidr` text NOT NULL,
	`description` text NOT NULL,
	`lifecycle_state` text NOT NULL,
	`tags` text NOT NULL,
	`layout_hints` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `operation_log` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`project_id` text NOT NULL,
	`change_set_id` text,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`role` text NOT NULL,
	`target_unit_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_log_id_unique` ON `operation_log` (`id`);--> statement-breakpoint
CREATE TABLE `policy_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`source` text NOT NULL,
	`destination` text NOT NULL,
	`service_id` text,
	`direction` text NOT NULL,
	`action` text NOT NULL,
	`logging` integer NOT NULL,
	`owner` text NOT NULL,
	`justification` text NOT NULL,
	`review_date` text,
	`lifecycle_state` text NOT NULL,
	`notes` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`created_at` text NOT NULL,
	`lifecycle_state` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `services` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`device_id` text,
	`name` text NOT NULL,
	`protocol` text NOT NULL,
	`port_start` integer,
	`port_end` integer,
	`process` text NOT NULL,
	`description` text NOT NULL,
	`lifecycle_state` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sites` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`lifecycle_state` text NOT NULL,
	`tags` text NOT NULL,
	`notes` text NOT NULL,
	`position` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `zones` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`site_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`description` text NOT NULL,
	`lifecycle_state` text NOT NULL,
	`tags` text NOT NULL,
	`notes` text NOT NULL,
	`position` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
