import { ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '../ui/button';

export type SidebarEdgeSide = 'left' | 'right';

export interface SidebarEdgeToggleProps {
  side: SidebarEdgeSide;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function iconFor(side: SidebarEdgeSide, open: boolean) {
  if (side === 'left') {
    return open ? ChevronLeft : ChevronRight;
  }
  return open ? ChevronRight : ChevronLeft;
}

export function SidebarEdgeToggle({ side, open, onOpenChange }: SidebarEdgeToggleProps) {
  const label = open ? `Hide ${side} panel` : `Show ${side} panel`;
  const Icon = iconFor(side, open);

  return (
    <Button
      variant="ghost"
      size="sm"
      type="button"
      className={cn(
        'h-full w-10 shrink-0 rounded-none px-0 text-foreground hover:bg-muted/80',
        side === 'left' ? 'border-r' : 'border-l'
      )}
      onClick={() => onOpenChange(!open)}
      aria-expanded={open}
      aria-label={label}
      title={label}
    >
      <Icon className="size-5" strokeWidth={2.25} aria-hidden />
    </Button>
  );
}
