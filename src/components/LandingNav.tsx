import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from './ui/button';
import { Menu, X } from 'lucide-react';

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
      <nav className="bg-slate-900 border-b border-slate-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-14 sm:h-16 min-h-[3.5rem] gap-4">
            <button
              onClick={() => navigate('/')}
              className="flex items-center gap-2 sm:gap-3 flex-shrink-0 hover:opacity-90 transition-opacity min-w-0"
              aria-label="Meridian Takeoff home"
            >
              <img src="/logo.png" alt="" className="h-8 w-8 sm:h-9 sm:w-9 rounded-lg object-contain flex-shrink-0" />
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
                  className="text-slate-300 hover:text-white hover:bg-slate-800"
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
                      className="text-slate-300 hover:text-white hover:bg-slate-800"
                    >
                      {link.label}
                    </Button>
                  ))}
                  {actionButton && (
                    <Button
                      onClick={actionButton.onClick}
                      className="bg-blue-600 hover:bg-blue-500 text-white"
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
                className="text-slate-300 hover:text-white hover:bg-slate-800 h-10 w-10"
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
            className="fixed top-0 right-0 bottom-0 w-full max-w-sm bg-slate-900 z-[70] md:hidden flex flex-col shadow-xl animate-in slide-in-from-right duration-200"
            role="dialog"
            aria-label="Navigation menu"
          >
            <div className="flex items-center justify-between h-14 px-4 border-b border-slate-800 flex-shrink-0">
              <span className="text-lg font-bold text-white">Menu</span>
              <Button
                variant="ghost"
                size="icon"
                className="text-slate-300 hover:text-white hover:bg-slate-800"
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
                  className="flex items-center px-4 py-3 text-left text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                >
                  Back to home
                </button>
              ) : (
                <>
                  {links?.map((link) => (
                    <button
                      key={link.label}
                      onClick={() => handleLinkClick(link.onClick)}
                      className="flex items-center px-4 py-3 text-left text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                    >
                      {link.label}
                    </button>
                  ))}
                  {actionButton && (
                    <button
                      onClick={handleActionClick}
                      className="flex items-center px-4 py-3 mt-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors"
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
