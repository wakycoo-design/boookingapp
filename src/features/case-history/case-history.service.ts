import { DomainError } from "@/features/shared/errors";
import { PG_UNIQUE_VIOLATION, pgError } from "@/features/shared/db-errors";
import { isUuid } from "@/features/shared/validation";
import type { StaffDTO } from "@/features/staff/staff.dto";
import { NotConfigured, type Sender } from "@/features/workflows/workflows.dto";
import { dayLabel } from "@/lib/format";
import type { CaseListFilters, CaseListRow, CaseRecordDTO, Delivery } from "./case-history.dto";
import type { CaseHistoryRepository, NoteRow } from "./case-history.repository";
import { addendumInput, followUpInput, intakeSteps, noteEditInput, noteInput, type IntakeStep } from "./case-history.schemas";
import { LABEL, overallRisk, type Risk } from "./choices";

/** Who is asking: a signed-in staff member. */
/** `seesAll`: may list every client (Roles & permissions, Case histories · view all); clinical details still need their therapist or a clinical admin. */
export type Reader = Pick<StaffDTO, "id" | "role" | "clinicalAdmin"> & { name?: string; seesAll?: boolean };

/** The WhatsApp template Meta must approve for follow-ups (see docs/whatsapp-templates.md). */
export const FOLLOW_UP_TEMPLATE = "follow_up_suggestion";

const noSender: Sender = async () => {
  throw new NotConfigured("not wired");
};

export function createCaseHistoryService({ caseRepo, senders = { email: noSender, whatsapp: noSender }, firmName = async () => "" }: {
  caseRepo: CaseHistoryRepository;
  senders?: { email: Sender; whatsapp: Sender };
  firmName?: () => Promise<string>;
}) {
  async function canRead(reader: Reader, clientId: string): Promise<boolean> {
    if (reader.clinicalAdmin) return true;
    return (await caseRepo.currentTherapistId(clientId)) === reader.id;
  }

  /** Opens the record for an allowed reader; everyone else is refused before anything is read. */
  async function open(reader: Reader, clientId: string): Promise<CaseRecordDTO> {
    if (!isUuid(clientId) || !(await caseRepo.clientExists(clientId))) throw new DomainError("not_found", `Client ${clientId} not found`);
    if (!(await canRead(reader, clientId))) {
      throw new DomainError("forbidden", `Only client ${clientId}'s therapist or a clinical admin can open this case history`);
    }
    return caseRepo.findOrCreate(clientId);
  }

  async function note(reader: Reader, noteId: string): Promise<NoteRow> {
    const row = isUuid(noteId) ? await caseRepo.findNote(noteId) : null;
    if (!row) throw new DomainError("not_found", `Session note ${noteId} not found`);
    if (!(await canRead(reader, row.clientId))) throw new DomainError("forbidden", `You can't change session note ${noteId}`);
    return row;
  }

  function ownDraft(reader: Reader, n: NoteRow) {
    if (n.signedAt) throw new DomainError("conflict", `Session note ${n.id} is signed; add an addendum instead`);
    if (n.authorId !== reader.id) throw new DomainError("forbidden", `Only the author can change draft note ${n.id}`);
  }

  // Audit rows name the fields that changed and never the clinical text itself.
  const audit = (reader: Reader, action: string, entity: string, entityId: string, details?: Record<string, unknown>) =>
    ({ actor: { staffId: reader.id }, action, entity, entityId, details });

  return {
    canRead,
    open,

    async saveIntake(reader: Reader, clientId: string, step: number, input: unknown) {
      if (!(step in intakeSteps)) throw new DomainError("invalid", `Intake step ${step} does not exist`);
      const data = intakeSteps[step as IntakeStep].parse(input);
      const record = await open(reader, clientId);
      await caseRepo.updateIntake(record.id, { ...data, updatedBy: reader.id }, audit(reader, "update_intake", "case_history", record.id, { step, fields: Object.keys(data) }));
    },

    async completeIntake(reader: Reader, clientId: string, now = new Date()) {
      const record = await open(reader, clientId);
      if (!record.presentingComplaints) throw new DomainError("invalid", `Write the presenting complaints for client ${clientId} before completing the intake`);
      if (!overallRisk([record.riskSuicide, record.riskSelfHarm, record.riskOthers])) {
        throw new DomainError("invalid", `Rate at least one risk for client ${clientId} before completing the intake`);
      }
      await caseRepo.updateIntake(record.id, { status: "in_treatment", intakeCompletedAt: now, intakeCompletedBy: reader.id, updatedBy: reader.id },
        audit(reader, "complete_intake", "case_history", record.id));
    },

    async addNote(reader: Reader, clientId: string, input: unknown): Promise<string> {
      const data = noteInput.parse(input);
      const record = await open(reader, clientId);
      let sessionAt: Date;
      if (data.bookingId) {
        const b = await caseRepo.bookingClient(data.bookingId);
        if (!b || b.clientId !== clientId) throw new DomainError("invalid", `Booking ${data.bookingId} is not one of client ${clientId}'s sessions`);
        sessionAt = b.startsAt;
      } else if (data.sessionOn) {
        // Midday UTC keeps the chosen date the same in every Indian and nearby time zone.
        sessionAt = new Date(`${data.sessionOn}T12:00:00Z`);
      } else {
        throw new DomainError("invalid", "Choose the booked session, or give the date of a session that wasn't booked");
      }
      const { bookingId, sessionOn: _, ...fields } = data;
      // Two notes saved at the same instant can pick the same number; the unique index catches it and the second simply tries again.
      for (let attempt = 0; ; attempt++) {
        try {
          return await caseRepo.insertNote(record.id, { ...fields, bookingId, sessionAt, authorId: reader.id },
            { actor: { staffId: reader.id }, action: "create", entity: "session_note", details: { caseHistoryId: record.id } });
        } catch (err) {
          const e = pgError(err);
          if (e.code !== PG_UNIQUE_VIOLATION) throw err;
          if (e.constraint?.includes("booking")) throw new DomainError("conflict", `Booking ${bookingId} already has a session note`);
          if (attempt >= 3) throw err;
        }
      }
    },

    async updateDraft(reader: Reader, noteId: string, input: unknown) {
      const data = noteEditInput.parse(input);
      const n = await note(reader, noteId);
      ownDraft(reader, n);
      if (!(await caseRepo.updateNote(noteId, data, audit(reader, "update", "session_note", noteId, { fields: Object.keys(data) })))) {
        throw new DomainError("conflict", `Session note ${noteId} was signed meanwhile; add an addendum instead`);
      }
    },

    async signNote(reader: Reader, noteId: string, now = new Date()) {
      const n = await note(reader, noteId);
      ownDraft(reader, n);
      if (!(await caseRepo.updateNote(noteId, { signedAt: now }, audit(reader, "sign", "session_note", noteId)))) {
        throw new DomainError("conflict", `Session note ${noteId} is already signed`);
      }
    },

    async deleteDraft(reader: Reader, noteId: string) {
      const n = await note(reader, noteId);
      ownDraft(reader, n);
      if (!(await caseRepo.deleteDraft(noteId, audit(reader, "delete", "session_note", noteId)))) {
        throw new DomainError("conflict", `Session note ${noteId} was signed meanwhile and can't be deleted`);
      }
    },

    async addAddendum(reader: Reader, noteId: string, input: unknown) {
      const { text } = addendumInput.parse(input);
      const n = await note(reader, noteId);
      if (!n.signedAt) throw new DomainError("invalid", `Session note ${noteId} is still a draft; edit it instead`);
      await caseRepo.addAddendum(noteId, reader.id, text, audit(reader, "addendum", "session_note", noteId));
    },

    /**
     * What the client page shows: the record for an allowed reader (without creating one), otherwise status and risk only.
     */
    async overview(reader: Reader, clientId: string): Promise<{ restricted: true; status: CaseRecordDTO["status"] | null; risk: Risk | null } | { restricted: false; record: CaseRecordDTO | null }> {
      if (await canRead(reader, clientId)) {
        const head = await caseRepo.headline(clientId);
        return { restricted: false, record: head ? await caseRepo.findOrCreate(clientId) : null };
      }
      const head = await caseRepo.headline(clientId);
      // No record yet is said plainly, not shown as a status nobody set.
      return { restricted: true, status: head?.status ?? null, risk: head?.risk ?? null };
    },

    /**
     * Suggests the client's next session by WhatsApp and/or email. Nothing is booked or held: the client arranges the
     * actual time. Each channel's outcome is recorded; one not set up or failing never stops the other.
     */
    async sendFollowUp(reader: Reader, clientId: string, input: unknown, now = new Date()) {
      const data = followUpInput.parse(input);
      if (data.suggestedOn < now.toISOString().slice(0, 10)) throw new DomainError("invalid", "The suggested date has already passed");
      const record = await open(reader, clientId);
      const c = await caseRepo.clientContact(clientId);
      if (!c) throw new DomainError("not_found", `Client ${clientId} not found`);
      const firm = await firmName();
      const therapist = reader.name ?? "Your therapist";
      const when = `${dayLabel(new Date(`${data.suggestedOn}T12:00:00Z`), "UTC")}${data.partOfDay ? ` (${LABEL[data.partOfDay].toLowerCase()})` : ""}`;
      const first = c.name.split(/\s+/)[0] ?? c.name;

      const attempt = async (chosen: boolean, has: boolean, send: () => Promise<unknown>): Promise<Delivery> => {
        if (!chosen) return "not_chosen";
        if (!has) return "no_contact";
        try {
          await send();
          return "sent";
        } catch (err) {
          return err instanceof NotConfigured ? "not_set_up" : "failed";
        }
      };
      const whatsapp = await attempt(data.whatsapp, true, () =>
        senders.whatsapp({ channel: "whatsapp", to: c.phoneE164, templateName: FOLLOW_UP_TEMPLATE, language: "en", params: [first, therapist, when] }));
      const email = await attempt(data.email, Boolean(c.email), () =>
        senders.email({
          channel: "email",
          to: c.email!,
          subject: `Your next session with ${therapist}`,
          body: [`Hi ${first},`, "", `${therapist} suggests your next session around ${when}.`, ...(data.note ? ["", data.note] : []), "",
            "Reply to this email or call us to fix a time that suits you.", "", firm ? `– ${firm}` : ""].join("\n").trim(),
        }));

      await caseRepo.insertFollowUp(
        { caseHistoryId: record.id, suggestedOn: data.suggestedOn, partOfDay: data.partOfDay, note: data.note, sentBy: reader.id, whatsapp, email },
        // The message text is not kept in the audit row, only what was sent where.
        { actor: { staffId: reader.id }, action: "create", entity: "follow_up", details: { suggestedOn: data.suggestedOn, whatsapp, email } },
      );
      return { whatsapp, email };
    },

    async noteableBookings(reader: Reader, clientId: string, now = new Date()) {
      await open(reader, clientId);
      return caseRepo.noteableBookings(clientId, now);
    },

    /**
     * The list, with clinical fields blanked where the reader may not see them. A therapist who is neither a clinical admin
     * nor a manager sees only their own clients.
     */
    async list(reader: Reader, f: CaseListFilters = {}): Promise<CaseListRow[]> {
      const seesEveryone = reader.clinicalAdmin || (reader.seesAll ?? reader.role !== "staff");
      const rows = (await caseRepo.list(f.q?.trim() || undefined))
        .filter((r) => seesEveryone || r.therapistId === reader.id)
        .map((r): CaseListRow => {
          const restricted = !(reader.clinicalAdmin || r.therapistId === reader.id);
          return {
            clientId: r.clientId, clientName: r.clientName, clientNumber: r.clientNumber, clientPhone: r.clientPhone,
            status: r.status ?? "intake_pending",
            risk: overallRisk([r.riskSuicide, r.riskSelfHarm, r.riskOthers]),
            restricted,
            diagnosisCode: restricted ? null : r.diagnosisCode,
            diagnosisLabel: restricted ? null : r.diagnosisLabel,
            therapistId: r.therapistId, therapistName: r.therapistName, therapistActive: r.therapistActive ?? true,
            notes: r.notes, lastNoteAt: r.lastNoteAt, lastNoteAuthor: restricted ? null : r.lastNoteAuthor,
          };
        });
      return rows.filter((r) =>
        (!f.status || (f.status === "high_risk" ? r.risk === "high" : r.status === f.status)) &&
        (!f.therapist || (f.therapist === "unassigned" ? !r.therapistId : r.therapistId === f.therapist)) &&
        (!f.risk || r.risk === f.risk) &&
        (!f.from || (r.lastNoteAt !== null && r.lastNoteAt >= f.from)) &&
        (!f.to || (r.lastNoteAt !== null && r.lastNoteAt < f.to)));
    },
  };
}

export type CaseHistoryService = ReturnType<typeof createCaseHistoryService>;
