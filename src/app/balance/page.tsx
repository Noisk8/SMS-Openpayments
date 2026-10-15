import { BalanceCard } from "@/components/balance-card";
import { getWebSession } from "@/lib/auth/current-user";
import { SignInRequired } from "@/app/payments/page";

export default async function BalancePage() {
  const session = await getWebSession();
  if (!session) {
    return <SignInRequired />;
  }
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Saldo</h1>
      <BalanceCard />
    </div>
  );
}