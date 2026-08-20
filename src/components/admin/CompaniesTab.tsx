import React, { useEffect, useState } from 'react';
import { Loader2, Building2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { organizationAdminService, type AdminOrganization } from '../../services/apiService';
import { extractErrorMessage } from '../../utils/commonUtils';
import { ConfirmInline } from '../ui/confirm-inline';

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
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

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

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const created = await organizationAdminService.create(name);
      setOrgs((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName('');
      toast.success(`Created "${created.name}" — invite its first user from User Management.`);
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Failed to create company'));
    } finally {
      setCreating(false);
    }
  };

  const handleToggle = async (org: AdminOrganization) => {
    const next = !org.assembliesEnabled;
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

      <div className="flex items-center gap-2 max-w-md">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New company name…"
          className="h-9"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleCreate();
          }}
        />
        <Button size="sm" onClick={() => void handleCreate()} disabled={creating || !newName.trim()}>
          <Plus className="w-4 h-4 mr-1" />
          {creating ? 'Creating…' : 'New company'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground -mt-4">
        After creating a company, invite its first user from User Management — a company
        picker appears there once more than one company exists.
      </p>

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
              <div className="flex items-center gap-2 text-sm select-none">
                <span className={org.assembliesEnabled ? 'text-foreground' : 'text-muted-foreground'}>
                  Assemblies
                </span>
                <ConfirmInline
                  confirmLabel={org.assembliesEnabled ? 'Revoke?' : 'Grant?'}
                  destructive={org.assembliesEnabled}
                  onConfirm={() => void handleToggle(org)}
                  trigger={(arm) => (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={org.assembliesEnabled}
                      aria-label={`${org.assembliesEnabled ? 'Revoke' : 'Grant'} assemblies for ${org.name}`}
                      disabled={togglingId === org.id}
                      onClick={arm}
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
                  )}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
