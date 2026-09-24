CREATE TABLE "customer_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"external_id" varchar(200) NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_sources_external_id_length" CHECK (char_length("customer_sources"."external_id") between 1 and 200)
);
--> statement-breakpoint
-- Backfill: each customer a connection already knew about becomes one alias.
--
-- This runs before the columns below are dropped. The old
-- `(organization_id, external_source, external_id)` unique index guaranteed at
-- most one customer per (connection, record id), so the alias table cannot
-- collide; a customer whose source connection was deleted has no match and keeps
-- working as a manual customer (its provenance is simply unknown).
INSERT INTO "customer_sources" (
	"organization_id", "customer_id", "integration_id", "external_id", "first_seen_at", "last_synced_at"
)
SELECT
	c."organization_id", c."id", i."id", c."external_id", c."created_at", now()
FROM "customers" c
JOIN "integrations" i
	ON i."organization_id" = c."organization_id"
 AND i."provider"::text = c."external_source"
WHERE c."external_id" IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Re-namespace product and order identities from the provider ('SHOPIFY') to the
-- connection id. Two connections on the same provider used to share one id
-- namespace, so one store's `12345` could match the other's.
UPDATE "products" p SET "external_source" = i."id"::text
FROM "integrations" i
WHERE i."organization_id" = p."organization_id"
	AND i."provider"::text = p."external_source"
	AND p."external_source" IS NOT NULL;
--> statement-breakpoint
UPDATE "orders" o SET "external_source" = i."id"::text
FROM "integrations" i
WHERE i."organization_id" = o."organization_id"
	AND i."provider"::text = o."external_source"
	AND o."external_source" IS NOT NULL;
--> statement-breakpoint
DROP INDEX "customers_org_external_unique";--> statement-breakpoint
DROP INDEX "integrations_org_provider_unique";--> statement-breakpoint
ALTER TABLE "customer_sources" ADD CONSTRAINT "customer_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_sources" ADD CONSTRAINT "customer_sources_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_sources" ADD CONSTRAINT "customer_sources_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_sources_integration_external_unique" ON "customer_sources" USING btree ("organization_id","integration_id","external_id");--> statement-breakpoint
CREATE INDEX "customer_sources_customer_idx" ON "customer_sources" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX "customer_sources_integration_idx" ON "customer_sources" USING btree ("organization_id","integration_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_org_provider_account_unique" ON "integrations" USING btree ("organization_id","provider","external_account_id") WHERE "integrations"."external_account_id" is not null;--> statement-breakpoint
ALTER TABLE "customers" DROP COLUMN "external_id";--> statement-breakpoint
ALTER TABLE "customers" DROP COLUMN "external_source";
