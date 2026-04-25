import { redirect } from "next/navigation";

export default function MarketDetailLegacyRedirect() {
  // v3 uses /series/[seriesId]; v1 markets.id deep-links redirect to markets list.
  redirect("/markets");
}
