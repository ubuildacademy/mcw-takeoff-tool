import { ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '../ui/button';

export type SidebarEdgeSide = 'left' | 'right';

export interface SidebarEdgeToggleProps {
  side: SidebarEdgeSide;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const iconClass = 'size-5';
const iconStroke = 2.25;

export function SidebarEdgeToggle({ side, open, onOpenChange }: SidebarEdgeToggleProps) {
  const label = open ? `Hide ${side} panel` : `Show ${side} panel`;

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
      {side === 'left' ? (
        open ? (
          <ChevronLeft className={iconClass} strokeWidth={iconStroke} aria-hidden />
        ) : (
          <ChevronRight className={iconClass} strokeWidth={iconStroke} aria-hidden />
        )
      ) : open ? (
        <ChevronRight className={iconClass} strokeWidth={iconStroke} aria-hidden />
      ) : (
        <ChevronLeft className={iconClass} strokeWidth={iconStroke} aria-hidden />
      )}
    </Button>
  );
}
