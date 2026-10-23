/** Business-wide settings (one row). Per-service values override the booking rules when set. */
export type BusinessSettingsDTO = {
  name: string;
  timezone: string;
  currency: string;
  bookingPrefix: string;
  slotIntervalMin: number;
  minNoticeMin: number;
  maxNoticeDays: number;
  /** Clients can't cancel or reschedule through the website closer than this to the start. */
  clientCutoffMin: number;
  /** Public booking page look. */
  logoUrl: string | null;
  brandColor: string;
  welcomeText: string | null;
  /** Page on the firm's website where clients finish an unpaid booking. */
  resumeUrl: string | null;
  /** Website bookings of priced services must be paid online: held 15 minutes, then failed. */
  onlinePayment: boolean;
  /** Services set to "Google Meet" get a Meet link for their sessions. */
  meetEnabled: boolean;
  /** Emails use the branded design. */
  emailBranded: boolean;
  /** Organization details. */
  email: string | null;
  phone: string | null;
  address: string | null;
  /** 0 = Sunday, 1 = Monday. */
  weekStart: number;
  timeFormat: "12h" | "24h";
  /** The firm's general opening times (all shifts). Shown only; each therapist's own hours decide bookings. */
  businessHours: { weekday: number; startTime: string; endTime: string }[];
};
