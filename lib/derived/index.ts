/**
 * Kolom turunan — one import for the whole thing.
 *
 *     import { deriveEmployeeColumns, formatMasa } from "@/lib/derived";
 *
 * FROZEN CONTRACT (Wave 1). See `employee.ts` for the columns themselves and
 * `pgAge.ts` for why they agree with `v_employees` down to the day.
 */
export {
  computeMasa,
  computeMasaJg,
  computeMasaKerja,
  computeMasaPg,
  computeMasaSejakDiangkat,
  computeUsia,
  deriveEmployeeColumns,
  formatMasa,
  formatMasaColumns,
  formatUsia,
  KOSONG,
  type DerivableEmployee,
  type DerivedEmployeeColumns,
  type Masa,
} from "./employee";

export {
  ageSince,
  daysInMonth,
  parseCalendarDate,
  pgAge,
  today,
  yearsSince,
  type CalendarDate,
  type DateInput,
  type PgAgeInterval,
} from "./pgAge";
