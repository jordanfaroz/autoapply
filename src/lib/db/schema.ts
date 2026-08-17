import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Nothing in this schema is site-specific. Sites appear only as `site` string
 * values (see `src/lib/sites.ts`), never as columns or tables.
 */

// ---------------------------------------------------------------------------
// Shared value types
// ---------------------------------------------------------------------------

export const JOB_STATUSES = [
  "scraped",
  "scored",
  "queued",
  "approved",
  "rejected",
  "applying",
  "applied",
  "parked_needs_input",
  "failed_needs_review",
  "manual_apply",
  "duplicate",
  "archived_low_score",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const RUN_TYPES = ["scrape", "apply"] as const;
export type RunType = (typeof RUN_TYPES)[number];

export const RUN_STATUSES = [
  "queued",
  "running",
  "paused_needs_attention",
  "completed",
  "failed",
  "stopped",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const ANSWER_TYPES = ["text", "number", "choice"] as const;
export type AnswerType = (typeof ANSWER_TYPES)[number];

export const WORK_MODES = ["onsite", "hybrid", "remote"] as const;
export type WorkMode = (typeof WORK_MODES)[number];

export type ExperienceEntry = {
  company: string;
  title: string;
  from: string;
  to: string;
  highlights: string[];
};

export type EducationEntry = {
  institution: string;
  degree: string;
  field?: string;
  from?: string;
  to?: string;
};

export type CertificationEntry = {
  name: string;
  issuer?: string;
  year?: string;
};

const now = () => new Date();

// ---------------------------------------------------------------------------
// profile — exactly one row (id is pinned to 1)
// ---------------------------------------------------------------------------

export const profile = sqliteTable("profile", {
  id: integer("id").primaryKey().default(1),

  // --- Parsed from the resume by Claude, then editable in the UI ---
  name: text("name"),
  email: text("email"),
  phone: text("phone"),
  location: text("location"),
  summary: text("summary"),
  skills: text("skills", { mode: "json" }).$type<string[]>().notNull().$defaultFn(() => []),
  experience: text("experience", { mode: "json" })
    .$type<ExperienceEntry[]>()
    .notNull()
    .$defaultFn(() => []),
  education: text("education", { mode: "json" })
    .$type<EducationEntry[]>()
    .notNull()
    .$defaultFn(() => []),
  certifications: text("certifications", { mode: "json" })
    .$type<CertificationEntry[]>()
    .notNull()
    .$defaultFn(() => []),
  resumeFilePath: text("resume_file_path"),
  resumeFileName: text("resume_file_name"),

  // --- Entered by hand; never inferred from the resume ---
  noticePeriod: text("notice_period"),
  currentCtc: text("current_ctc"),
  expectedCtc: text("expected_ctc"),
  preferredLocations: text("preferred_locations", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .$defaultFn(() => []),
  workMode: text("work_mode", { enum: WORK_MODES }),
  willingToRelocate: integer("willing_to_relocate", { mode: "boolean" })
    .notNull()
    .default(false),
  totalExperienceYears: real("total_experience_years"),

  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(now),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(now),
});

// ---------------------------------------------------------------------------
// answer_bank — the only source of screening-question answers
// ---------------------------------------------------------------------------

export const answerBank = sqliteTable(
  "answer_bank",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Canonical phrasing, stored as written. */
    question: text("question").notNull(),
    /** `normalizeQuestion(question)` — the dedupe and parked-match key. */
    questionNormalized: text("question_normalized").notNull(),
    answer: text("answer").notNull(),
    type: text("type", { enum: ANSWER_TYPES }).notNull().default("text"),
    createdFrom: text("created_from", { enum: ["manual", "parked_job"] })
      .notNull()
      .default("manual"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(now),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex("answer_bank_question_normalized_unique").on(t.questionNormalized)],
);

// ---------------------------------------------------------------------------
// jobs
// ---------------------------------------------------------------------------

export const jobs = sqliteTable(
  "jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    site: text("site").notNull(),
    externalUrl: text("external_url").notNull(),

    company: text("company").notNull(),
    title: text("title").notNull(),
    location: text("location"),
    salaryText: text("salary_text"),
    /** Full JD text captured at scrape time — a snapshot, never re-fetched. */
    jdText: text("jd_text"),

    scrapedAt: integer("scraped_at", { mode: "timestamp" }).notNull().$defaultFn(now),
    /** normalized(company) + "::" + normalized(title) */
    dedupeKey: text("dedupe_key").notNull(),

    matchScore: integer("match_score"),
    matchReasoning: text("match_reasoning"),

    status: text("status", { enum: JOB_STATUSES }).notNull().default("scraped"),
    /** Set when status === "duplicate": points at the job we already had. */
    duplicateOfJobId: integer("duplicate_of_job_id"),
    /** Scrape run that discovered this job. */
    discoveredByRunId: integer("discovered_by_run_id"),

    /** Populated when an apply fails mid-form, for manual review. */
    failureReason: text("failure_reason"),
    failureScreenshotPath: text("failure_screenshot_path"),

    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(now),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [
    uniqueIndex("jobs_external_url_unique").on(t.externalUrl),
    index("jobs_dedupe_key_idx").on(t.dedupeKey),
    index("jobs_status_idx").on(t.status),
    index("jobs_site_idx").on(t.site),
    index("jobs_score_idx").on(t.matchScore),
  ],
);

// ---------------------------------------------------------------------------
// applications — one row per submitted (or dry-run) application
// ---------------------------------------------------------------------------

export const applications = sqliteTable(
  "applications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    appliedAt: integer("applied_at", { mode: "timestamp" }).notNull().$defaultFn(now),
    /** Exact question -> answer pairs used, for the audit trail and copy-paste reuse. */
    answersUsed: text("answers_used", { mode: "json" })
      .$type<Array<{ question: string; answer: string }>>()
      .notNull()
      .$defaultFn(() => []),
    /** Tailored cover-letter / "why you" text, when the form had such a field. */
    blurb: text("blurb"),
    /** True when the final submit was deliberately not clicked. */
    dryRun: integer("dry_run", { mode: "boolean" }).notNull().default(true),
    runId: integer("run_id"),
  },
  (t) => [
    index("applications_job_id_idx").on(t.jobId),
    index("applications_applied_at_idx").on(t.appliedAt),
  ],
);

// ---------------------------------------------------------------------------
// parked_questions — questions Claude could not confidently map to the bank
// ---------------------------------------------------------------------------

export const parkedQuestions = sqliteTable(
  "parked_questions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    questionText: text("question_text").notNull(),
    /** `normalizeQuestion(questionText)` — groups identical questions across jobs. */
    questionNormalized: text("question_normalized").notNull(),
    /** Set once you answer it in the Answer Bank; unblocks every job waiting on it. */
    resolvedAnswerId: integer("resolved_answer_id").references(() => answerBank.id, {
      onDelete: "set null",
    }),
    resolvedAt: integer("resolved_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [
    index("parked_questions_job_id_idx").on(t.jobId),
    index("parked_questions_normalized_idx").on(t.questionNormalized),
  ],
);

// ---------------------------------------------------------------------------
// runs — scrape / apply run log
// ---------------------------------------------------------------------------

export const runs = sqliteTable(
  "runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    type: text("type", { enum: RUN_TYPES }).notNull(),
    site: text("site").notNull(),
    status: text("status", { enum: RUN_STATUSES }).notNull().default("queued"),

    startedAt: integer("started_at", { mode: "timestamp" }).notNull().$defaultFn(now),
    finishedAt: integer("finished_at", { mode: "timestamp" }),

    /** Free-form per-run tallies, e.g. { scraped, duplicates, queued, applied, parked }. */
    counts: text("counts", { mode: "json" })
      .$type<Record<string, number>>()
      .notNull()
      .$defaultFn(() => ({})),
    errors: text("errors", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .$defaultFn(() => []),

    /** Set when a CAPTCHA / verification wall pauses the run; surfaced in the UI. */
    pausedReason: text("paused_reason"),
    /** OS pid of the worker process, so a stale run can be detected after a crash. */
    workerPid: integer("worker_pid"),
    dryRun: integer("dry_run", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [
    index("runs_status_idx").on(t.status),
    index("runs_started_at_idx").on(t.startedAt),
    index("runs_site_idx").on(t.site),
  ],
);

// ---------------------------------------------------------------------------
// settings — one global row, plus one row per site
// ---------------------------------------------------------------------------

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),
  /** Jobs scoring below this are archived instead of queued. */
  scoreThreshold: integer("score_threshold").notNull().default(70),
  /** Global kill-switch for actually submitting. ON by default. */
  dryRun: integer("dry_run", { mode: "boolean" }).notNull().default(true),
  activeHoursStart: text("active_hours_start").notNull().default("09:00"),
  activeHoursEnd: text("active_hours_end").notNull().default("21:00"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(now),
});

export const siteSettings = sqliteTable("site_settings", {
  /** Matches a `SiteId` from src/lib/sites.ts. */
  site: text("site").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),

  // --- Search criteria ---
  keywords: text("keywords", { mode: "json" }).$type<string[]>().notNull().$defaultFn(() => []),
  locations: text("locations", { mode: "json" }).$type<string[]>().notNull().$defaultFn(() => []),
  experienceMin: real("experience_min"),
  experienceMax: real("experience_max"),
  /** Annual, in whatever unit you think in. Stored as text to stay unit-agnostic. */
  salaryFloor: text("salary_floor"),

  // --- Guardrails ---
  dailyApplyCap: integer("daily_apply_cap").notNull().default(30),
  activeHoursStart: text("active_hours_start"),
  activeHoursEnd: text("active_hours_end"),

  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(now),
});

// ---------------------------------------------------------------------------
// Inferred row types
// ---------------------------------------------------------------------------

export type Profile = typeof profile.$inferSelect;
export type AnswerBankEntry = typeof answerBank.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type Application = typeof applications.$inferSelect;
export type ParkedQuestion = typeof parkedQuestions.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type Settings = typeof settings.$inferSelect;
export type SiteSettings = typeof siteSettings.$inferSelect;
