CREATE TYPE "public"."campaign_status" AS ENUM('DRAFT', 'SCHEDULED', 'RUNNING', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."campaign_type" AS ENUM('REORDER_REMINDER', 'OVERDUE_FOLLOW_UP', 'WIN_BACK', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."channel" AS ENUM('WHATSAPP', 'SMS', 'EMAIL');--> statement-breakpoint
CREATE TYPE "public"."contact_status" AS ENUM('NEW', 'IN_REVIEW', 'RESOLVED', 'SPAM');--> statement-breakpoint
CREATE TYPE "public"."contact_topic" AS ENUM('Learn about ReorderIQ', 'Request a Product Demo', 'Pricing', 'Custom Pricing', 'Integration', 'Existing Customer Support', 'Partnership', 'Other');--> statement-breakpoint
CREATE TYPE "public"."integration_provider" AS ENUM('ZOHO_INVENTORY', 'SHOPIFY', 'WOOCOMMERCE', 'PAYSTACK', 'MPESA', 'WHATSAPP_BUSINESS', 'SMS_GATEWAY', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."integration_status" AS ENUM('PENDING', 'CONNECTED', 'ERROR', 'DISCONNECTED');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('OWNER', 'ADMIN', 'ANALYST', 'SALES');--> statement-breakpoint
CREATE TYPE "public"."member_status" AS ENUM('ACTIVE', 'INVITED', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('OUTBOUND', 'INBOUND');--> statement-breakpoint
CREATE TYPE "public"."message_provider" AS ENUM('DEMO', 'WHATSAPP_BUSINESS', 'SMS_GATEWAY', 'EMAIL');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'RECEIVED');--> statement-breakpoint
CREATE TYPE "public"."opportunity_status" AS ENUM('UPCOMING', 'DUE', 'OVERDUE', 'HIGH_OPPORTUNITY', 'AT_RISK', 'CONTACTED', 'ORDER_CREATED', 'CONVERTED', 'DISMISSED');--> statement-breakpoint
CREATE TYPE "public"."order_source" AS ENUM('MANUAL', 'SIMULATED', 'API', 'IMPORT');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('COMPLETED', 'PENDING', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."payment_provider" AS ENUM('NONE', 'MPESA', 'PAYSTACK', 'INVOICE');--> statement-breakpoint
CREATE TYPE "public"."plan" AS ENUM('SMALL', 'MEDIUM', 'LARGE', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."recipient_status" AS ENUM('QUEUED', 'SENT', 'FAILED', 'SKIPPED', 'CONVERTED');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"actor_user_id" text,
	"action" varchar(80) NOT NULL,
	"entity_type" varchar(60) NOT NULL,
	"entity_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_hash" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" "recipient_status" DEFAULT 'QUEUED' NOT NULL,
	"sent_at" timestamp with time zone,
	"revenue_attributed" numeric(14, 2) DEFAULT 0 NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_recipients_revenue_non_negative" CHECK ("campaign_recipients"."revenue_attributed" >= 0)
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"type" "campaign_type" DEFAULT 'REORDER_REMINDER' NOT NULL,
	"channel" "channel" DEFAULT 'WHATSAPP' NOT NULL,
	"status" "campaign_status" DEFAULT 'DRAFT' NOT NULL,
	"audience_filter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"message_template" text,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_name_length" CHECK (char_length("campaigns"."name") between 2 and 160)
);
--> statement-breakpoint
CREATE TABLE "contact_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"business_name" varchar(160) NOT NULL,
	"email" varchar(200) NOT NULL,
	"phone" varchar(32),
	"topic" "contact_topic" NOT NULL,
	"message" text NOT NULL,
	"status" "contact_status" DEFAULT 'NEW' NOT NULL,
	"source_ip_hash" varchar(64),
	"user_agent" varchar(300),
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_submissions_message_length" CHECK (char_length("contact_submissions"."message") between 20 and 4000)
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"initials" varchar(8),
	"phone" varchar(32) NOT NULL,
	"email" varchar(200),
	"location" varchar(120),
	"customer_type" varchar(40) DEFAULT 'BUSINESS' NOT NULL,
	"assigned_salesperson" varchar(160),
	"assigned_to_user_id" text,
	"marketing_opt_in" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"last_order_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_name_length" CHECK (char_length("customers"."name") between 2 and 160),
	CONSTRAINT "customers_phone_length" CHECK (char_length("customers"."phone") between 6 and 32)
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"status" "integration_status" DEFAULT 'PENDING' NOT NULL,
	"display_name" varchar(120),
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_ref" varchar(200),
	"external_account_id" varchar(120),
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "member_role" DEFAULT 'SALES' NOT NULL,
	"status" "member_status" DEFAULT 'ACTIVE' NOT NULL,
	"invited_email" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"campaign_id" uuid,
	"channel" "channel" DEFAULT 'WHATSAPP' NOT NULL,
	"direction" "message_direction" DEFAULT 'OUTBOUND' NOT NULL,
	"status" "message_status" DEFAULT 'QUEUED' NOT NULL,
	"provider" "message_provider" DEFAULT 'DEMO' NOT NULL,
	"body" text NOT NULL,
	"provider_message_id" varchar(120),
	"error_message" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_body_length" CHECK (char_length("messages"."body") between 1 and 4000)
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"expected_date" date NOT NULL,
	"reorder_score" smallint NOT NULL,
	"expected_value" numeric(14, 2) NOT NULL,
	"probability" smallint NOT NULL,
	"status" "opportunity_status" DEFAULT 'UPCOMING' NOT NULL,
	"last_contacted_at" timestamp with time zone,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunities_score_range" CHECK ("opportunities"."reorder_score" between 0 and 100),
	CONSTRAINT "opportunities_probability_range" CHECK ("opportunities"."probability" between 0 and 100),
	CONSTRAINT "opportunities_value_non_negative" CHECK ("opportunities"."expected_value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid,
	"product_name" varchar(160) NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"line_total" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_quantity_range" CHECK ("order_items"."quantity" between 1 and 100000),
	CONSTRAINT "order_items_price_non_negative" CHECK ("order_items"."unit_price" >= 0 and "order_items"."line_total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"reference" varchar(40) NOT NULL,
	"status" "order_status" DEFAULT 'COMPLETED' NOT NULL,
	"source" "order_source" DEFAULT 'MANUAL' NOT NULL,
	"payment_method" varchar(60),
	"currency" varchar(8) DEFAULT 'KES' NOT NULL,
	"subtotal" numeric(14, 2) DEFAULT 0 NOT NULL,
	"total" numeric(14, 2) DEFAULT 0 NOT NULL,
	"ordered_at" timestamp with time zone NOT NULL,
	"notes" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_total_non_negative" CHECK ("orders"."total" >= 0 and "orders"."subtotal" >= 0),
	CONSTRAINT "orders_reference_format" CHECK ("orders"."reference" ~ '^[A-Za-z0-9._-]{3,40}$')
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"slug" varchar(80) NOT NULL,
	"industry" varchar(120) DEFAULT 'General' NOT NULL,
	"country" varchar(80) DEFAULT 'Kenya' NOT NULL,
	"currency" varchar(8) DEFAULT 'KES' NOT NULL,
	"timezone" varchar(64) DEFAULT 'Africa/Nairobi' NOT NULL,
	"owner_user_id" text NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_format" CHECK ("organizations"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "organizations_name_length" CHECK (char_length("organizations"."name") between 2 and 160)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"sku" varchar(64),
	"category" varchar(120),
	"unit" varchar(32) DEFAULT 'unit' NOT NULL,
	"price" numeric(14, 2) DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_price_non_negative" CHECK ("products"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "rate_limit_counters" (
	"bucket" varchar(160) NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rate_limit_counters_pk" PRIMARY KEY("bucket","window_start"),
	CONSTRAINT "rate_limit_counters_hits_non_negative" CHECK ("rate_limit_counters"."hits" >= 0)
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"plan" "plan" DEFAULT 'SMALL' NOT NULL,
	"status" "subscription_status" DEFAULT 'TRIALING' NOT NULL,
	"payment_provider" "payment_provider" DEFAULT 'NONE' NOT NULL,
	"seats" integer DEFAULT 1 NOT NULL,
	"amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"currency" varchar(8) DEFAULT 'KES' NOT NULL,
	"current_period_start" timestamp with time zone DEFAULT now() NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"cancelled_at" timestamp with time zone,
	"external_reference" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_seats_range" CHECK ("subscriptions"."seats" between 1 and 5000),
	CONSTRAINT "subscriptions_amount_non_negative" CHECK ("subscriptions"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_format" CHECK ("user"."email" ~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$')
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_assigned_to_user_id_user_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_account_unique" ON "account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_org_created_idx" ON "audit_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_recipients_unique" ON "campaign_recipients" USING btree ("campaign_id","customer_id");--> statement-breakpoint
CREATE INDEX "campaign_recipients_org_status_idx" ON "campaign_recipients" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "campaigns_org_status_idx" ON "campaigns" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "campaigns_org_created_idx" ON "campaigns" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "contact_submissions_created_idx" ON "contact_submissions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "contact_submissions_email_idx" ON "contact_submissions" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "customers_org_email_unique" ON "customers" USING btree ("organization_id",lower("email")) WHERE "customers"."email" is not null;--> statement-breakpoint
CREATE INDEX "customers_org_name_idx" ON "customers" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "customers_org_last_order_idx" ON "customers" USING btree ("organization_id","last_order_at");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_org_provider_unique" ON "integrations" USING btree ("organization_id","provider");--> statement-breakpoint
CREATE INDEX "integrations_org_status_idx" ON "integrations" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "members_org_user_unique" ON "members" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "members_user_idx" ON "members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "members_org_idx" ON "members" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "messages_org_created_idx" ON "messages" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_customer_created_idx" ON "messages" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_campaign_idx" ON "messages" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "opportunities_org_customer_date_unique" ON "opportunities" USING btree ("organization_id","customer_id","expected_date");--> statement-breakpoint
CREATE INDEX "opportunities_org_status_idx" ON "opportunities" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "opportunities_org_expected_idx" ON "opportunities" USING btree ("organization_id","expected_date");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_org_product_idx" ON "order_items" USING btree ("organization_id","product_name");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_org_reference_unique" ON "orders" USING btree ("organization_id","reference");--> statement-breakpoint
CREATE INDEX "orders_org_ordered_at_idx" ON "orders" USING btree ("organization_id","ordered_at");--> statement-breakpoint
CREATE INDEX "orders_customer_ordered_at_idx" ON "orders" USING btree ("customer_id","ordered_at");--> statement-breakpoint
CREATE INDEX "orders_org_status_idx" ON "orders" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_unique" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "organizations_owner_idx" ON "organizations" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_org_name_unique" ON "products" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "products_org_sku_unique" ON "products" USING btree ("organization_id","sku") WHERE "products"."sku" is not null;--> statement-breakpoint
CREATE INDEX "products_org_idx" ON "products" USING btree ("organization_id","is_active");--> statement-breakpoint
CREATE INDEX "rate_limit_counters_expires_idx" ON "rate_limit_counters" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_unique" ON "session" USING btree ("token");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_expires_idx" ON "session" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_org_unique" ON "subscriptions" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_unique" ON "user" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");