import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** The app has no dashboard; Karyawan is the home screen. */
export default function Home() {
  redirect("/karyawan");
}
