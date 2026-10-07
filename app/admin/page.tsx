import type { Metadata } from "next";
import AdminDashboard from "@/components/dashboard/admin/AdminDashboard";
import { APP_DISPLAY_NAME } from "@/lib/constant";

export const metadata: Metadata = {
  title: `Admin · ${APP_DISPLAY_NAME}`,
};

export default function AdminPage() {
  return <AdminDashboard />;
}
