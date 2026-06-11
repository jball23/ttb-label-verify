ALTER TABLE "applications" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "applications_archived_at_idx" ON "applications" USING btree ("archived_at");