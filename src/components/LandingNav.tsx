import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from './ui/button';
import { Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavLink {
  label: string;
  onClick: () => void;
}

interface LandingNavProps {
  /** Optional right-side links (Features, Pricing, Contact). Omit for auth pages. */
  links?: NavLink[];
  /** Right-side action button (e.g. "Login"). Omit to hide. */
  actionButton?: { label: string; onClick: () => void };
  /** For auth pages: show "Back to home" instead of full links. */
  showBackToHome?: boolean;
}

interface MeridianBrandMarkProps {
  className?: string;
  /** Use "light" when the M is white/light, "dark" when the M is dark, or "auto" on theme-aware surfaces. */
  tone?: 'auto' | 'light' | 'dark';
}

export function MeridianBrandMark({ className = 'h-9 w-9', tone = 'auto' }: MeridianBrandMarkProps) {
  const tickColor =
    tone === 'light' ? 'hsl(222 47% 7%)' : tone === 'dark' ? 'white' : 'hsl(var(--background))';

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 64 64"
      className={cn(
        'overflow-visible text-slate-950 dark:text-white',
        className
      )}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g stroke="rgb(147 197 253)" strokeWidth="0.9" opacity="0.45">
        <path d="M8 14H56M8 26H56M8 38H56M8 50H56" />
        <path d="M12 8V56M24 8V56M40 8V56M52 8V56" />
      </g>
      <path
        d="M7.5 55V9H22.5L32 33.5L41.5 9H56.5V55H43.5V29.5L35.5 55H28.5L20.5 29.5V55H7.5Z"
        fill="currentColor"
      />
      <g stroke={tickColor} strokeLinecap="round" strokeWidth="1.65">
        <path d="M9.5 17H18.5" />
        <path d="M9.5 21H15.5" />
        <path d="M9.5 25H15.5" />
        <path d="M9.5 29H17" />
        <path d="M9.5 33H15.5" />
        <path d="M9.5 37H15.5" />
        <path d="M9.5 41H18.5" />
        <path d="M9.5 45H15.5" />
        <path d="M9.5 49H17" />
      </g>
      <path
        d="M32 6V58"
        stroke="rgb(59 130 246)"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <path
        d="M32 6V58"
        stroke="rgb(147 197 253)"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.7"
      />
    </svg>
  );
}

export function LandingNav({ links, actionButton, showBackToHome }: LandingNavProps) {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const closeMobileMenu = () => setMobileMenuOpen(false);

  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileMenuOpen]);

  const handleLinkClick = (onClick: () => void) => {
    onClick();
    closeMobileMenu();
  };

  const handleActionClick = () => {
    actionButton?.onClick();
    closeMobileMenu();
  };

  return (
    <>
      <nav className="sticky top-0 z-50 border-b border-white/10 bg-slate-950/[0.88] backdrop-blur-xl supports-[backdrop-filter]:bg-slate-950/[0.76]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-14 sm:h-16 min-h-[3.5rem] gap-4">
            <button
              onClick={() => navigate('/')}
              className="group flex items-center gap-2 sm:gap-3 flex-shrink-0 transition-opacity min-w-0"
              aria-label="Meridian Takeoff home"
            >
              <MeridianBrandMark className="h-8 w-8 flex-shrink-0 text-white transition-transform duration-200 group-hover:scale-105 sm:h-9 sm:w-9" tone="light" />
              <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-white truncate">
                Meridian <span className="text-blue-400">Takeoff</span>
              </h1>
            </button>
            {/* Desktop nav - visible md and up */}
            <div className="hidden md:flex items-center flex-shrink-0 space-x-4">
              {showBackToHome ? (
                <Button
                  onClick={() => navigate('/')}
                  variant="ghost"
                  className="rounded-lg text-slate-300 hover:text-white hover:bg-white/[0.08] transition-colors"
                >
                  Back to home
                </Button>
              ) : (
                <>
                  {links?.map((link) => (
                    <Button
                      key={link.label}
                      onClick={link.onClick}
                      variant="ghost"
                      className="rounded-lg text-slate-300 hover:text-white hover:bg-white/[0.08] transition-colors"
                    >
                      {link.label}
                    </Button>
                  ))}
                  {actionButton && (
                    <Button
                      onClick={actionButton.onClick}
                      className="marketing-cta-primary"
                    >
                      {actionButton.label}
                    </Button>
                  )}
                </>
              )}
            </div>
            {/* Mobile hamburger - visible below md */}
            <div className="flex md:hidden items-center flex-shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="text-slate-300 hover:text-white hover:bg-white/[0.08] h-10 w-10"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Open menu"
              >
                <Menu className="h-6 w-6" />
              </Button>
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile menu overlay & panel */}
      {mobileMenuOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-[60] md:hidden animate-in fade-in-0"
            onClick={closeMobileMenu}
            aria-hidden="true"
          />
          <div
            className="fixed top-0 right-0 bottom-0 w-full max-w-sm bg-slate-950 z-[70] md:hidden flex flex-col shadow-2xl animate-in slide-in-from-right duration-200"
            role="dialog"
            aria-label="Navigation menu"
          >
            <div className="flex items-center justify-between h-14 px-4 border-b border-slate-800 flex-shrink-0">
              <span className="text-lg font-bold text-white">Menu</span>
              <Button
                variant="ghost"
                size="icon"
                className="text-slate-300 hover:text-white hover:bg-white/[0.08]"
                onClick={closeMobileMenu}
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="flex flex-col p-4 gap-1 overflow-auto">
              {showBackToHome ? (
                <button
                  onClick={() => handleLinkClick(() => navigate('/'))}
                  className="flex items-center px-4 py-3 text-left text-slate-300 hover:text-white hover:bg-white/[0.08] rounded-lg transition-colors"
                >
                  Back to home
                </button>
              ) : (
                <>
                  {links?.map((link) => (
                    <button
                      key={link.label}
                      onClick={() => handleLinkClick(link.onClick)}
                      className="flex items-center px-4 py-3 text-left text-slate-300 hover:text-white hover:bg-white/[0.08] rounded-lg transition-colors"
                    >
                      {link.label}
                    </button>
                  ))}
                  {actionButton && (
                    <button
                      onClick={handleActionClick}
                      className="marketing-cta-primary flex items-center px-4 py-3 mt-2 font-medium"
                    >
                      {actionButton.label}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
