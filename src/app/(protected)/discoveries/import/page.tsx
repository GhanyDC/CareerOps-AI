import { DiscoveryImportForm } from "@/components/discovery-import-form";
import { getRequestContext } from "@/server/request-context";

export const dynamic = "force-dynamic";

export default async function DiscoveryImportPage() {
  await getRequestContext();
  return (
    <div className="page-stack narrow-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Discovery import</p>
          <h1>Preview raw opportunities before storage</h1>
          <p>CareerOps preserves provenance but does not parse, score, or apply to these jobs.</p>
        </div>
      </div>
      <DiscoveryImportForm />
    </div>
  );
}
