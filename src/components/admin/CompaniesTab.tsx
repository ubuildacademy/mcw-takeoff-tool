import React, { useEffect, useState } from 'react';
import { Loader2, Building2 } from 'lucide-react';
import { toast } from 'sonner';
import { organizationAdminService, type AdminOrganization } from '../../services/apiService';
import { extractErrorMessage } from '../../utils/commonUtils';

/**
 * Platform-admin-only company roster. The one control here today is the assemblies
 * upsell switch (Jeff, 2026-08-10): a company without it enabled loses the feature
 * everywhere — Conditions' assembly picker, the Costs tab, and its own admin panel's
 * Assemblies/Product Pricing/Cost Defaults tabs — the moment it's toggled off.
 */
export function CompaniesTab() {
  const [orgs, setOrgs] = useState<AdminOrganization[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setOrgs(await organizationAdminService.list());
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Failed to load companies'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleToggle = async (org: AdminOrganization) => {
    const next = !org.assembliesEnabled;
    if (!confirm(`${next ? 'Grant' : 'Revoke'} the assemblies feature for ${org.name}?`)) return;
    setTogglingId(org.id);
    try {
      await organizationAdminService.setAssembliesEnabled(org.id, next);
      setOrgs((prev) => prev.map((o) => (o.id === org.id ? { ...o, assembliesEnabled: next } : o)));
      toast.success(`Assemblies ${next ? 'enabled' : 'disabled'} for ${org.name}`);
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Failed to update company'));
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Building2 className="w-6 h-6" />
          Companies
        </h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Every company on the platform. Assemblies is a paid add-on — toggle it per
          company to grant or revoke it.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading companies…
        </div>
      ) : orgs.length === 0 ? (
        <div className="border border-border rounded-lg bg-card p-6 shadow-sm">
          <p className="text-sm text-muted-foreground">No companies yet.</p>
        </div>
      ) : (
        <div className="border border-border rounded-lg bg-card divide-y divide-border shadow-sm overflow-hidden">
          {orgs.map((org) => (
            <div key={org.id} className="flex items-center justify-between gap-3 p-4">
              <div>
                <div className="font-medium">{org.name}</div>
                <div className="text-xs text-muted-foreground">
                  Created {new Date(org.createdAt).toLocaleDateString()}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <span className={org.assembliesEnabled ? 'text-foreground' : 'text-muted-foreground'}>
                  Assemblies
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={org.assembliesEnabled}
                  disabled={togglingId === org.id}
                  onClick={() => handleToggle(org)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
                    org.assembliesEnabled ? 'bg-primary' : 'bg-muted'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-background transition-transform ${
                      org.assembliesEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
