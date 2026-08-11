import { useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { CheckCircle, Loader2, Palette } from 'lucide-react';
import { toast } from 'sonner';
import { reportBrandingService } from '../../services/apiService';
import { DEFAULT_REPORT_BRANDING, REPORT_LOGO_MAX_BYTES, hexToARGB } from '../takeoff-sidebar/export/branding';
import { extractErrorMessage } from '../../utils/commonUtils';

const adminPanelSection = 'border border-border rounded-lg bg-card p-6 shadow-sm';
const adminHelpText = 'text-sm text-muted-foreground';

/**
 * Per-company white-label settings for Excel export headers — P.O., Work Order, Budget
 * report, and the standard takeoff export (task: branding org-scoping, 2026-08-10).
 * Moved out of the platform-only AI Settings tab: this used to be one global setting
 * shared by every company, so a second company would have gotten MCW's own name/logo
 * on their exports. Visible to any company admin now, not just the platform admin.
 */
export function BrandingTab() {
  const [companyName, setCompanyName] = useState('');
  const [accentColor, setAccentColor] = useState(`#${DEFAULT_REPORT_BRANDING.accentARGB.slice(2)}`);
  const [logoBase64, setLogoBase64] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const branding = await reportBrandingService.get();
        if (branding.companyName) setCompanyName(branding.companyName);
        if (branding.accentColor) {
          const argb = hexToARGB(branding.accentColor);
          if (argb) setAccentColor(`#${argb.slice(2)}`);
        }
        setLogoBase64(branding.logoBase64);
      } catch (error) {
        toast.error(extractErrorMessage(error, 'Failed to load branding'));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleLogoFile = (file: File | undefined) => {
    if (!file) return;
    if (file.type !== 'image/png') {
      toast.error('Logo must be a PNG file');
      return;
    }
    if (file.size > REPORT_LOGO_MAX_BYTES) {
      toast.error(`Logo must be ${Math.round(REPORT_LOGO_MAX_BYTES / 1024)}KB or smaller`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogoBase64(reader.result as string);
    reader.onerror = () => toast.error('Failed to read logo file');
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    const argb = hexToARGB(accentColor);
    if (accentColor.trim() !== '' && !argb) {
      toast.error('Accent color must be a hex value like #3B82F6');
      return;
    }
    setSaving(true);
    try {
      await reportBrandingService.update({
        companyName: companyName.trim() || null,
        accentColor: accentColor.trim() || null,
        logoBase64,
      });
      toast.success('Branding saved!');
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Failed to save branding'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2 text-muted-foreground text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading branding…
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Palette className="w-6 h-6" />
          Branding
        </h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          White-labels every Excel export from your company — the takeoff export, P.O.,
          Work Order, and Budget report title blocks. Leave blank to keep the default
          Meridian Takeoff branding.
        </p>
      </div>

      <div className={adminPanelSection}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Company Name</Label>
            <Input
              type="text"
              placeholder={DEFAULT_REPORT_BRANDING.name}
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
            <p className={`${adminHelpText} mt-1`}>Shown as "{'{Name}'} — TAKEOFF REPORT"</p>
          </div>
          <div>
            <Label>Accent Color</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                className="h-9 w-12 rounded border border-input bg-background"
                value={hexToARGB(accentColor) ? `#${hexToARGB(accentColor)!.slice(2)}` : '#3B82F6'}
                onChange={(e) => setAccentColor(e.target.value)}
              />
              <Input
                type="text"
                placeholder="#3B82F6"
                value={accentColor}
                onChange={(e) => setAccentColor(e.target.value)}
              />
            </div>
            <p className={`${adminHelpText} mt-1`}>Hex color used for report borders/accents</p>
          </div>
        </div>
        <div className="mt-4">
          <Label>Logo (PNG, max {Math.round(REPORT_LOGO_MAX_BYTES / 1024)}KB)</Label>
          <div className="flex items-center gap-3 mt-1">
            <input
              type="file"
              accept="image/png"
              onChange={(e) => handleLogoFile(e.target.files?.[0])}
              className="text-sm text-foreground"
            />
            {logoBase64 && (
              <>
                <img src={logoBase64} alt="Report logo preview" className="h-10 w-auto rounded border border-border" />
                <Button variant="outline" size="sm" onClick={() => setLogoBase64(null)}>
                  Remove
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="mt-4">
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-2" />}
            {saving ? 'Saving…' : 'Save Branding'}
          </Button>
        </div>
      </div>
    </div>
  );
}
