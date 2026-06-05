import { useState } from 'react';
import { Link } from 'react-router-dom';
import { HelpCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { getHelpTopic, type HelpTopicId } from '../../content/helpContent';
import { cn } from '@/lib/utils';

export type HelpTopicTriggerProps = {
  topicId: HelpTopicId;
  className?: string;
  /** Banner variant uses a light icon on colored backgrounds */
  tone?: 'default' | 'on-banner';
};

export function HelpTopicTrigger({ topicId, className, tone = 'default' }: HelpTopicTriggerProps) {
  const [open, setOpen] = useState(false);
  const topic = getHelpTopic(topicId);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            'h-7 w-7 shrink-0',
            tone === 'on-banner' && 'text-inherit hover:bg-black/10',
            className
          )}
          aria-label={`Help: ${topic.question}`}
          onClick={(e) => e.stopPropagation()}
        >
          <HelpCircle className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        animated={false}
        className="w-[min(18rem,calc(100vw-2rem))]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <p className="text-sm font-semibold text-foreground">{topic.question}</p>
        <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{topic.answer}</p>
        <Link
          to={topic.guideHref}
          className="mt-3 inline-block text-xs text-primary hover:underline"
          onClick={() => setOpen(false)}
        >
          Open full guide →
        </Link>
      </PopoverContent>
    </Popover>
  );
}
