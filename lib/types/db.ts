// AUTO-GENERATED — DO NOT EDIT BY HAND.
//
// Produced by `npm run gen:types` (scripts/gen-types-from-pg.ts) from the live
// catalog of a database with every supabase/migrations/*.sql applied.
// The Supabase CLI's `gen types` cannot run in this environment, so this is
// the project's source of database types.
//
// To change a type, change the migration and regenerate:
//     npm run db:local && npm run gen:types
//
// FROZEN CONTRACT: downstream work reads this file, never edits it.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      employees: {
        Row: {
          id: string;
          personnel_number: string;
          nip: string | null;
          full_name: string;
          org_unit_id: string | null;
          jabatan_id: string | null;
          gender_id: string | null;
          work_contract_id: string | null;
          person_grade_id: string | null;
          job_grade_id: string | null;
          legal_entity_id: string | null;
          klasifikasi_rekrutmen_id: string | null;
          teknik_non_teknik_id: string | null;
          bod_range_id: string | null;
          band_jabatan_id: string | null;
          kategori_penempatan_id: string | null;
          kategori_fungsi_id: string | null;
          keterangan_pj_plt: string | null;
          keterangan_rangkap_1: string | null;
          keterangan_rangkap_2: string | null;
          keterangan: string | null;
          jurusan: string | null;
          original_start_date: string | null;
          tanggal_diangkat: string | null;
          tanggal_promosi_pg: string | null;
          tanggal_promosi_jg: string | null;
          tanggal_keluar: string | null;
          nomor_surat_pg: string | null;
          nomor_surat_jg: string | null;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          personnel_number: string;
          nip?: string | null;
          full_name: string;
          org_unit_id?: string | null;
          jabatan_id?: string | null;
          gender_id?: string | null;
          work_contract_id?: string | null;
          person_grade_id?: string | null;
          job_grade_id?: string | null;
          legal_entity_id?: string | null;
          klasifikasi_rekrutmen_id?: string | null;
          teknik_non_teknik_id?: string | null;
          bod_range_id?: string | null;
          band_jabatan_id?: string | null;
          kategori_penempatan_id?: string | null;
          kategori_fungsi_id?: string | null;
          keterangan_pj_plt?: string | null;
          keterangan_rangkap_1?: string | null;
          keterangan_rangkap_2?: string | null;
          keterangan?: string | null;
          jurusan?: string | null;
          original_start_date?: string | null;
          tanggal_diangkat?: string | null;
          tanggal_promosi_pg?: string | null;
          tanggal_promosi_jg?: string | null;
          tanggal_keluar?: string | null;
          nomor_surat_pg?: string | null;
          nomor_surat_jg?: string | null;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          personnel_number?: string;
          nip?: string | null;
          full_name?: string;
          org_unit_id?: string | null;
          jabatan_id?: string | null;
          gender_id?: string | null;
          work_contract_id?: string | null;
          person_grade_id?: string | null;
          job_grade_id?: string | null;
          legal_entity_id?: string | null;
          klasifikasi_rekrutmen_id?: string | null;
          teknik_non_teknik_id?: string | null;
          bod_range_id?: string | null;
          band_jabatan_id?: string | null;
          kategori_penempatan_id?: string | null;
          kategori_fungsi_id?: string | null;
          keterangan_pj_plt?: string | null;
          keterangan_rangkap_1?: string | null;
          keterangan_rangkap_2?: string | null;
          keterangan?: string | null;
          jurusan?: string | null;
          original_start_date?: string | null;
          tanggal_diangkat?: string | null;
          tanggal_promosi_pg?: string | null;
          tanggal_promosi_jg?: string | null;
          tanggal_keluar?: string | null;
          nomor_surat_pg?: string | null;
          nomor_surat_jg?: string | null;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      employee_private: {
        Row: {
          employee_id: string;
          date_of_birth: string | null;
          place_of_birth: string | null;
          religion: string | null;
          marital_status: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          employee_id: string;
          date_of_birth?: string | null;
          place_of_birth?: string | null;
          religion?: string | null;
          marital_status?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          employee_id?: string;
          date_of_birth?: string | null;
          place_of_birth?: string | null;
          religion?: string | null;
          marital_status?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      org_units: {
        Row: {
          id: string;
          kode: string;
          nama: string;
          tipe: string;
          parent_id: string | null;
          status: string;
          merged_into_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          kode: string;
          nama: string;
          tipe: string;
          parent_id?: string | null;
          status?: string;
          merged_into_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          kode?: string;
          nama?: string;
          tipe?: string;
          parent_id?: string | null;
          status?: string;
          merged_into_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      jabatan: {
        Row: {
          id: string;
          kode: string;
          nama: string;
          status: string;
          merged_into_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          kode: string;
          nama: string;
          status?: string;
          merged_into_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          kode?: string;
          nama?: string;
          status?: string;
          merged_into_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      lookups: {
        Row: {
          id: string;
          tipe: string;
          kode: string;
          label: string;
          urutan: number | null;
          status: string;
          merged_into_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tipe: string;
          kode: string;
          label: string;
          urutan?: number | null;
          status?: string;
          merged_into_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tipe?: string;
          kode?: string;
          label?: string;
          urutan?: number | null;
          status?: string;
          merged_into_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      batches: {
        Row: {
          id: string;
          jenis: string;
          keterangan: string | null;
          actor_id: string | null;
          reverted_by_batch_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          jenis: string;
          keterangan?: string | null;
          actor_id?: string | null;
          reverted_by_batch_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          jenis?: string;
          keterangan?: string | null;
          actor_id?: string | null;
          reverted_by_batch_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      revisions: {
        Row: {
          id: number;
          batch_id: string;
          table_name: string;
          row_id: string;
          action: string;
          before: Json | null;
          after: Json;
          actor_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          batch_id: string;
          table_name: string;
          row_id: string;
          action: string;
          before?: Json | null;
          after: Json;
          actor_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          batch_id?: string;
          table_name?: string;
          row_id?: string;
          action?: string;
          before?: Json | null;
          after?: Json;
          actor_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      api_keys: {
        Row: {
          id: string;
          nama_konsumen: string;
          key_prefix: string | null;
          key_hash: string | null;
          allowed_fields: string[];
          status: string;
          last_used_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          nama_konsumen: string;
          key_prefix?: string | null;
          key_hash?: string | null;
          allowed_fields?: string[];
          status?: string;
          last_used_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          nama_konsumen?: string;
          key_prefix?: string | null;
          key_hash?: string | null;
          allowed_fields?: string[];
          status?: string;
          last_used_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          email: string;
          role: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          role?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          role?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      v_employees: {
        Row: {
          id: string;
          personnel_number: string;
          nip: string | null;
          full_name: string;
          status: string;
          org_unit_id: string | null;
          org_unit_kode: string | null;
          org_unit_nama: string | null;
          org_unit_tipe: string | null;
          direktorat_nama: string | null;
          divisi_nama: string | null;
          departemen_nama: string | null;
          bagian_nama: string | null;
          sub_bagian_nama: string | null;
          proyek_nama: string | null;
          jabatan_id: string | null;
          jabatan_kode: string | null;
          jabatan_nama: string | null;
          gender_id: string | null;
          gender_kode: string | null;
          gender_label: string | null;
          work_contract_id: string | null;
          work_contract_kode: string | null;
          work_contract_label: string | null;
          person_grade_id: string | null;
          person_grade_kode: string | null;
          person_grade_label: string | null;
          job_grade_id: string | null;
          job_grade_kode: string | null;
          job_grade_label: string | null;
          legal_entity_id: string | null;
          legal_entity_kode: string | null;
          legal_entity_label: string | null;
          klasifikasi_rekrutmen_id: string | null;
          klasifikasi_rekrutmen_kode: string | null;
          klasifikasi_rekrutmen_label: string | null;
          teknik_non_teknik_id: string | null;
          teknik_non_teknik_kode: string | null;
          teknik_non_teknik_label: string | null;
          bod_range_id: string | null;
          bod_range_kode: string | null;
          bod_range_label: string | null;
          band_jabatan_id: string | null;
          band_jabatan_kode: string | null;
          band_jabatan_label: string | null;
          kategori_penempatan_id: string | null;
          kategori_penempatan_kode: string | null;
          kategori_penempatan_label: string | null;
          kategori_fungsi_id: string | null;
          kategori_fungsi_kode: string | null;
          kategori_fungsi_label: string | null;
          keterangan_pj_plt: string | null;
          keterangan_rangkap_1: string | null;
          keterangan_rangkap_2: string | null;
          keterangan: string | null;
          jurusan: string | null;
          original_start_date: string | null;
          tanggal_diangkat: string | null;
          tanggal_promosi_pg: string | null;
          nomor_surat_pg: string | null;
          tanggal_promosi_jg: string | null;
          nomor_surat_jg: string | null;
          tanggal_keluar: string | null;
          masa_kerja_tahun: number | null;
          masa_kerja_bulan: number | null;
          masa_sejak_diangkat_tahun: number | null;
          masa_sejak_diangkat_bulan: number | null;
          masa_pg_tahun: number | null;
          masa_jg_tahun: number | null;
          created_at: string;
          updated_at: string;
        };
        Relationships: [];
      };
      v_employees_private: {
        Row: {
          id: string;
          personnel_number: string;
          nip: string | null;
          full_name: string;
          status: string;
          org_unit_id: string | null;
          org_unit_kode: string | null;
          org_unit_nama: string | null;
          org_unit_tipe: string | null;
          direktorat_nama: string | null;
          divisi_nama: string | null;
          departemen_nama: string | null;
          bagian_nama: string | null;
          sub_bagian_nama: string | null;
          proyek_nama: string | null;
          jabatan_id: string | null;
          jabatan_kode: string | null;
          jabatan_nama: string | null;
          gender_id: string | null;
          gender_kode: string | null;
          gender_label: string | null;
          work_contract_id: string | null;
          work_contract_kode: string | null;
          work_contract_label: string | null;
          person_grade_id: string | null;
          person_grade_kode: string | null;
          person_grade_label: string | null;
          job_grade_id: string | null;
          job_grade_kode: string | null;
          job_grade_label: string | null;
          legal_entity_id: string | null;
          legal_entity_kode: string | null;
          legal_entity_label: string | null;
          klasifikasi_rekrutmen_id: string | null;
          klasifikasi_rekrutmen_kode: string | null;
          klasifikasi_rekrutmen_label: string | null;
          teknik_non_teknik_id: string | null;
          teknik_non_teknik_kode: string | null;
          teknik_non_teknik_label: string | null;
          bod_range_id: string | null;
          bod_range_kode: string | null;
          bod_range_label: string | null;
          band_jabatan_id: string | null;
          band_jabatan_kode: string | null;
          band_jabatan_label: string | null;
          kategori_penempatan_id: string | null;
          kategori_penempatan_kode: string | null;
          kategori_penempatan_label: string | null;
          kategori_fungsi_id: string | null;
          kategori_fungsi_kode: string | null;
          kategori_fungsi_label: string | null;
          keterangan_pj_plt: string | null;
          keterangan_rangkap_1: string | null;
          keterangan_rangkap_2: string | null;
          keterangan: string | null;
          jurusan: string | null;
          original_start_date: string | null;
          tanggal_diangkat: string | null;
          tanggal_promosi_pg: string | null;
          nomor_surat_pg: string | null;
          tanggal_promosi_jg: string | null;
          nomor_surat_jg: string | null;
          tanggal_keluar: string | null;
          masa_kerja_tahun: number | null;
          masa_kerja_bulan: number | null;
          masa_sejak_diangkat_tahun: number | null;
          masa_sejak_diangkat_bulan: number | null;
          masa_pg_tahun: number | null;
          masa_jg_tahun: number | null;
          created_at: string;
          updated_at: string;
          date_of_birth: string | null;
          place_of_birth: string | null;
          religion: string | null;
          marital_status: string | null;
          usia: number | null;
        };
        Relationships: [];
      };
      v_employees_api: {
        Row: {
          id: string;
          personnel_number: string;
          nip: string | null;
          full_name: string;
          status: string;
          tanggal_keluar: string | null;
          org_unit_id: string | null;
          org_unit_kode: string | null;
          org_unit_nama: string | null;
          org_unit_tipe: string | null;
          direktorat_nama: string | null;
          divisi_nama: string | null;
          departemen_nama: string | null;
          bagian_nama: string | null;
          sub_bagian_nama: string | null;
          proyek_nama: string | null;
          jabatan_id: string | null;
          jabatan_kode: string | null;
          jabatan_nama: string | null;
          keterangan_pj_plt: string | null;
          keterangan_rangkap_1: string | null;
          keterangan_rangkap_2: string | null;
          gender_kode: string | null;
          gender_label: string | null;
          work_contract_kode: string | null;
          work_contract_label: string | null;
          person_grade_kode: string | null;
          person_grade_label: string | null;
          job_grade_kode: string | null;
          job_grade_label: string | null;
          legal_entity_kode: string | null;
          legal_entity_label: string | null;
          klasifikasi_rekrutmen_kode: string | null;
          klasifikasi_rekrutmen_label: string | null;
          teknik_non_teknik_kode: string | null;
          teknik_non_teknik_label: string | null;
          bod_range_kode: string | null;
          bod_range_label: string | null;
          band_jabatan_kode: string | null;
          band_jabatan_label: string | null;
          kategori_penempatan_kode: string | null;
          kategori_penempatan_label: string | null;
          kategori_fungsi_kode: string | null;
          kategori_fungsi_label: string | null;
          original_start_date: string | null;
          tanggal_diangkat: string | null;
          tanggal_promosi_pg: string | null;
          nomor_surat_pg: string | null;
          tanggal_promosi_jg: string | null;
          nomor_surat_jg: string | null;
          masa_kerja_tahun: number | null;
          masa_kerja_bulan: number | null;
          masa_pg_tahun: number | null;
          masa_jg_tahun: number | null;
          jurusan: string | null;
          keterangan: string | null;
          updated_at: string;
        };
        Relationships: [];
      };
    };
    Functions: {
      apply_revert: {
        Args: {
          p_plan: Json;
        };
        Returns: Json;
      };
      apply_revert_operation: {
        Args: {
          p_op: Json;
        };
        Returns: number;
      };
      assert_admin: {
        Args: {
          p_aksi: string;
        };
        Returns: undefined;
      };
      assert_lookup_tipe: {
        Args: {
          p_id: string;
          p_tipe: string;
          p_kolom: string;
        };
        Returns: undefined;
      };
      begin_batch: {
        Args: {
          p_jenis: string;
          p_keterangan?: string;
          p_local?: boolean;
        };
        Returns: string;
      };
      current_actor_id: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
      current_app_role: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
      current_batch_id: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
      end_batch: {
        Args: Record<PropertyKey, never>;
        Returns: undefined;
      };
      is_admin: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      merge_jabatan: {
        Args: {
          p_source: string;
          p_target: string;
          p_keterangan?: string;
        };
        Returns: Json;
      };
      merge_lookup: {
        Args: {
          p_source: string;
          p_target: string;
          p_keterangan?: string;
        };
        Returns: Json;
      };
      merge_org_unit: {
        Args: {
          p_source: string;
          p_target: string;
          p_keterangan?: string;
        };
        Returns: Json;
      };
      revert_batch: {
        Args: {
          p_batch_id: string;
          p_keterangan?: string;
        };
        Returns: Json;
      };
      revert_plan_for_batch: {
        Args: {
          p_batch_id: string;
        };
        Returns: Json;
      };
      revert_skip_entry: {
        Args: {
          p_revision_id: number;
          p_table_name: string;
          p_row_id: string;
          p_reason: string;
        };
        Returns: Json;
      };
      seed_from_payload: {
        Args: {
          p_payload: Json;
          p_keterangan?: string;
          p_force?: boolean;
        };
        Returns: Json;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

type PublicSchema = Database["public"];

export type Tables<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Update"];
export type ViewRow<T extends keyof PublicSchema["Views"]> =
  PublicSchema["Views"][T]["Row"];
export type FunctionArgs<T extends keyof PublicSchema["Functions"]> =
  PublicSchema["Functions"][T]["Args"];
export type FunctionReturns<T extends keyof PublicSchema["Functions"]> =
  PublicSchema["Functions"][T]["Returns"];

// Convenience aliases for the rows this app passes around most.
export type Employee = Tables<"employees">;
export type EmployeePrivate = Tables<"employee_private">;
export type OrgUnit = Tables<"org_units">;
export type Jabatan = Tables<"jabatan">;
export type Lookup = Tables<"lookups">;
export type Batch = Tables<"batches">;
export type Revision = Tables<"revisions">;
export type ApiKey = Tables<"api_keys">;
export type Profile = Tables<"profiles">;

export type VEmployee = ViewRow<"v_employees">;
export type VEmployeePrivate = ViewRow<"v_employees_private">;
export type VEmployeeApi = ViewRow<"v_employees_api">;
