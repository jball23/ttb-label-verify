CREATE TABLE "label_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewer" text,
	"decision" text NOT NULL,
	"reason" text,
	CONSTRAINT "label_decisions_decision_check" CHECK ("label_decisions"."decision" in ('approved','rejected'))
);
--> statement-breakpoint
CREATE TABLE "labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"batch_id" uuid,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"content_hash" text NOT NULL,
	"image_bytes" "bytea" NOT NULL,
	"reader_model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"latency_ms" integer NOT NULL,
	"reading" jsonb NOT NULL,
	"expected" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"corrections" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"verdict" text NOT NULL,
	"status" text DEFAULT 'to_review' NOT NULL,
	"status_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "labels_verdict_check" CHECK ("labels"."verdict" in ('looks_good','needs_review','problems_found')),
	CONSTRAINT "labels_status_check" CHECK ("labels"."status" in ('to_review','approved','rejected'))
);
--> statement-breakpoint
ALTER TABLE "label_decisions" ADD CONSTRAINT "label_decisions_label_id_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "label_decisions_label_id_idx" ON "label_decisions" USING btree ("label_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "labels_created_at_idx" ON "labels" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "labels_status_idx" ON "labels" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "labels_reading_cache_idx" ON "labels" USING btree ("content_hash","prompt_version","reader_model");