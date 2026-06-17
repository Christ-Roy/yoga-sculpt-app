import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Entry point. There is no public landing page for the client area —
 * we route based on auth + onboarding state.
 */
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_completed")
    .eq("id", user.id)
    .maybeSingle();

  redirect(profile?.onboarding_completed ? "/espace" : "/onboarding");
}
