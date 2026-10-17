-- Profile details are opt-in for both existing owners and new installations.
ALTER TABLE "users" ADD COLUMN "public_page_show_name" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "public_page_show_avatar" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "public_page_show_bio" BOOLEAN NOT NULL DEFAULT false;
