CREATE TYPE "public"."sync_run_status" AS ENUM('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."sync_trigger" AS ENUM('MANUAL', 'SCHEDULE');--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"trigger" "sync_trigger" DEFAULT 'MANUAL' NOT NULL,
	"status" "sync_run_status" DEFAULT 'RUNNING' NOT NULL,
	"counts" jsonb DEFAULT '{"customers":{"fetched":0,"created":0,"updated":0,"rejected":0},"products":{"fetched":0,"created":0,"updated":0,"rejected":0},"orders":{"fetched":0,"created":0,"updated":0,"rejected":0},"rejections":[]}'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "external_id" varchar(200);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "external_source" varchar(40);--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "connector" jsonb;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "secret_ciphertext" text;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "sync_interval_minutes" smallint DEFAULT 360 NOT NULL;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "next_sync_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "external_id" varchar(200);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "external_source" varchar(40);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "external_id" varchar(200);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "external_source" varchar(40);--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_runs_integration_started_idx" ON "sync_runs" USING btree ("integration_id","started_at");--> statement-breakpoint
CREATE INDEX "sync_runs_org_started_idx" ON "sync_runs" USING btree ("organization_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_org_external_unique" ON "customers" USING btree ("organization_id","external_source","external_id") WHERE "customers"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "integrations_due_idx" ON "integrations" USING btree ("status","next_sync_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_org_external_unique" ON "orders" USING btree ("organization_id","external_source","external_id") WHERE "orders"."external_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "products_org_external_unique" ON "products" USING btree ("organization_id","external_source","external_id") WHERE "products"."external_id" is not null;