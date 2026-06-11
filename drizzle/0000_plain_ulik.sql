CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_filename" text NOT NULL,
	"content_hash" text NOT NULL,
	"byte_size" integer NOT NULL,
	"prompt_version" text NOT NULL,
	"extractor_model" text NOT NULL,
	"latency_ms" integer NOT NULL,
	"extracted_form" jsonb NOT NULL,
	"extracted_label" jsonb NOT NULL,
	"validation_report" jsonb NOT NULL,
	"ai_verdict" text NOT NULL,
	"current_status" text DEFAULT 'pending_review' NOT NULL,
	"current_status_at" timestamp with time zone DEFAULT now() NOT NULL,
	"brand_name" text,
	"applicant_name" text,
	"ttb_serial_number" text,
	CONSTRAINT "applications_ai_verdict_check" CHECK ("applications"."ai_verdict" in ('compliant','needs_review','non_compliant')),
	CONSTRAINT "applications_current_status_check" CHECK ("applications"."current_status" in ('pending_review','approved','rejected','needs_more_info'))
);
--> statement-breakpoint
CREATE TABLE "prompt_versions" (
	"version" text PRIMARY KEY NOT NULL,
	"introduced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewer_label" text,
	"decision" text NOT NULL,
	"decision_reason" text,
	"field_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "reviews_decision_check" CHECK ("reviews"."decision" in ('approved','rejected','needs_more_info'))
);
--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applications_created_at_idx" ON "applications" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "applications_current_status_idx" ON "applications" USING btree ("current_status");--> statement-breakpoint
CREATE INDEX "applications_content_hash_idx" ON "applications" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "applications_brand_name_idx" ON "applications" USING btree (lower("brand_name"));--> statement-breakpoint
CREATE INDEX "applications_ttb_serial_idx" ON "applications" USING btree ("ttb_serial_number");--> statement-breakpoint
CREATE INDEX "reviews_application_id_idx" ON "reviews" USING btree ("application_id","created_at" DESC NULLS LAST);