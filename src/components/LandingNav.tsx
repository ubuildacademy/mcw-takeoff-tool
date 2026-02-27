import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from './ui/button';

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

  return (
    <nav className="bg-slate-900 border-b border-slate-800 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-3 flex-shrink-0 hover:opacity-90 transition-opacity"
            aria-label="Meridian Takeoff home"
          >
            <img src="/logo.png" alt="" className="h-9 w-9 rounded-lg object-contain" />
            <h1 className="text-2xl font-bold text-white">
              Meridian <span className="text-blue-400">Takeoff</span>
            </h1>
          </button>
          <div className="flex items-center space-x-4">
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
        </div>
      </div>
    </nav>
  );
}
