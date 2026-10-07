import type { Metadata } from "next";
import { AuthGuard } from "@/components/auth/auth-guard";
import ClientDashboard from "@/components/dashboard/client/ClientDashboard";
import { APP_DISPLAY_NAME } from "@/lib/constant";

export const metadata: Metadata = {
  title: `Dashboard · ${APP_DISPLAY_NAME}`,
};

export default function DashboardPage() {
  return (
    <AuthGuard>
      <ClientDashboard />
    </AuthGuard>
  );
}
