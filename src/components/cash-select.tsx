import { cashAccounts } from "@/lib/accounting";
import { ACC } from "@/lib/ledger";

// اختيار الصندوق أو البنك في سندات القبض والصرف
export async function CashAccountSelect({ name = "cashAccount", className = "w-auto" }: { name?: string; className?: string }) {
  const accounts = await cashAccounts();
  return (
    <select name={name} defaultValue={ACC.BANK} className={className} aria-label="من حساب">
      {accounts.map((a) => (
        <option key={a.id} value={a.code}>
          {a.code} · {a.name}
        </option>
      ))}
    </select>
  );
}
