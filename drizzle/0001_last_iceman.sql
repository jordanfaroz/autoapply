DROP INDEX `answer_bank_question_unique`;--> statement-breakpoint
ALTER TABLE `answer_bank` ADD `question_normalized` text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `answer_bank_question_normalized_unique` ON `answer_bank` (`question_normalized`);--> statement-breakpoint
DROP INDEX `parked_questions_text_idx`;--> statement-breakpoint
ALTER TABLE `parked_questions` ADD `question_normalized` text NOT NULL;--> statement-breakpoint
CREATE INDEX `parked_questions_normalized_idx` ON `parked_questions` (`question_normalized`);