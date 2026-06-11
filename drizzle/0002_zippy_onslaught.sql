ALTER TABLE "applications" DROP CONSTRAINT "applications_current_status_check";--> statement-breakpoint
ALTER TABLE "reviews" DROP CONSTRAINT "reviews_decision_check";--> statement-breakpoint
ALTER TABLE "applications" ALTER COLUMN "current_status" SET DEFAULT 'pending_approval';--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_current_status_check" CHECK ("applications"."current_status" in ('pending_approval','pending_rejection','approved','rejected'));--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_decision_check" CHECK ("reviews"."decision" in ('approved','rejected'));