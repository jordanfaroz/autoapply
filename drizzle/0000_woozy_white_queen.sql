CREATE TABLE `answer_bank` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`question` text NOT NULL,
	`answer` text NOT NULL,
	`type` text DEFAULT 'text' NOT NULL,
	`created_from` text DEFAULT 'manual' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `answer_bank_question_unique` ON `answer_bank` (`question`);--> statement-breakpoint
CREATE TABLE `applications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`applied_at` integer NOT NULL,
	`answers_used` text NOT NULL,
	`blurb` text,
	`dry_run` integer DEFAULT true NOT NULL,
	`run_id` integer,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `applications_job_id_idx` ON `applications` (`job_id`);--> statement-breakpoint
CREATE INDEX `applications_applied_at_idx` ON `applications` (`applied_at`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site` text NOT NULL,
	`external_url` text NOT NULL,
	`company` text NOT NULL,
	`title` text NOT NULL,
	`location` text,
	`salary_text` text,
	`jd_text` text,
	`scraped_at` integer NOT NULL,
	`dedupe_key` text NOT NULL,
	`match_score` integer,
	`match_reasoning` text,
	`status` text DEFAULT 'scraped' NOT NULL,
	`duplicate_of_job_id` integer,
	`discovered_by_run_id` integer,
	`failure_reason` text,
	`failure_screenshot_path` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_external_url_unique` ON `jobs` (`external_url`);--> statement-breakpoint
CREATE INDEX `jobs_dedupe_key_idx` ON `jobs` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);--> statement-breakpoint
CREATE INDEX `jobs_site_idx` ON `jobs` (`site`);--> statement-breakpoint
CREATE INDEX `jobs_score_idx` ON `jobs` (`match_score`);--> statement-breakpoint
CREATE TABLE `parked_questions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`question_text` text NOT NULL,
	`resolved_answer_id` integer,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resolved_answer_id`) REFERENCES `answer_bank`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `parked_questions_job_id_idx` ON `parked_questions` (`job_id`);--> statement-breakpoint
CREATE INDEX `parked_questions_text_idx` ON `parked_questions` (`question_text`);--> statement-breakpoint
CREATE TABLE `profile` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`name` text,
	`email` text,
	`phone` text,
	`location` text,
	`summary` text,
	`skills` text NOT NULL,
	`experience` text NOT NULL,
	`education` text NOT NULL,
	`certifications` text NOT NULL,
	`resume_file_path` text,
	`resume_file_name` text,
	`notice_period` text,
	`current_ctc` text,
	`expected_ctc` text,
	`preferred_locations` text NOT NULL,
	`work_mode` text,
	`willing_to_relocate` integer DEFAULT false NOT NULL,
	`total_experience_years` real,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`site` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`counts` text NOT NULL,
	`errors` text NOT NULL,
	`paused_reason` text,
	`worker_pid` integer,
	`dry_run` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX `runs_status_idx` ON `runs` (`status`);--> statement-breakpoint
CREATE INDEX `runs_started_at_idx` ON `runs` (`started_at`);--> statement-breakpoint
CREATE INDEX `runs_site_idx` ON `runs` (`site`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`score_threshold` integer DEFAULT 70 NOT NULL,
	`dry_run` integer DEFAULT true NOT NULL,
	`active_hours_start` text DEFAULT '09:00' NOT NULL,
	`active_hours_end` text DEFAULT '21:00' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `site_settings` (
	`site` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`keywords` text NOT NULL,
	`locations` text NOT NULL,
	`experience_min` real,
	`experience_max` real,
	`salary_floor` text,
	`daily_apply_cap` integer DEFAULT 30 NOT NULL,
	`active_hours_start` text,
	`active_hours_end` text,
	`updated_at` integer NOT NULL
);
