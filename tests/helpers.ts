import { sql } from "drizzle-orm";
import { createDb } from "@/db";
import { createContainer } from "@/features/container";

export const testUrl = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5433/booking_test";
process.env.DATABASE_URL = testUrl;

export const db = createDb(testUrl);
export const c = createContainer(db);

export async function reset() {
  await db.execute(sql`
    truncate follow_up, session_note_addendum, session_note, case_history, otp_request, audit_log, slot_hold, booking_calendar_event, calendar_busy, date_override, notification, booking, client_package, package, client_therapist, client, calendar_connection,
      time_off, working_hours, staff_service, service, staff, api_key, workflow, holiday restart identity cascade`);
  // The business row survives a reset. Most tests look at the plain wording of a message, so they start with the styled design off;
  // the tests of the design turn it on themselves. Start times go back to the default for tests that change them.
  // Built-in roles stay (the migration made them); custom roles and changed ticks go.
  await db.execute(sql`delete from role_permission`);
  await db.execute(sql`delete from inbox_item`);
  await db.execute(sql`delete from conversation`);
  await db.execute(sql`insert into conversation (kind, title) values ('everyone', 'Everyone')`);
  await db.execute(sql`delete from role where not system`);
  await db.execute(sql`update business set email_branded = false, slot_interval_min = 30, in_app_events = null`);
}
