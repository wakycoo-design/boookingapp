export type StaffRole = "admin" | "manager" | "staff";

/** What the person does, as opposed to `role`, which says what they may do in the app. */
export const DESIGNATIONS = ["Psychiatrist", "Psychologist", "Nutritionist", "Sales Executive"] as const;
export type Designation = (typeof DESIGNATIONS)[number];

export type StaffDTO = {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  /** The role on the permissions page (`role` is its base). Null only for rows made before roles existed. */
  roleId: string | null;
  designation: Designation | null;
  timezone: string;
  active: boolean;
  /** May read and write every client's clinical record. */
  clinicalAdmin: boolean;
};

/** What the website may see about a staff member. */
/** `pricePaise` is what this person charges for the service asked about (their own price, else the service's); null when it has no plain price. */
export type PublicStaffDTO = { id: string; name: string; timezone: string; pricePaise: number | null };
