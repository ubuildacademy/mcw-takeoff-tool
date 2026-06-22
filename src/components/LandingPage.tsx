import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Calculator,
  Check,
  FileText,
  Layers,
  MessageSquare,
  Ruler,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import { Button } from './ui/button';
import { LandingNav, MeridianBrandMark } from './LandingNav';

const featureCards = [
  {
    icon: Ruler,
    title: 'Precision PDF takeoffs',
    description:
      'Calibrate drawings, measure areas, lengths, counts, and cut-outs, then keep every quantity tied to the plan.',
    accent: 'bg-blue-50 text-blue-600 border-blue-100',
  },
  {
    icon: MessageSquare,
    title: 'AI document chat',
    description:
      'Ask the plans, specs, and schedules direct questions and get context-aware answers while you estimate.',
    accent: 'bg-indigo-50 text-indigo-600 border-indigo-100',
  },
  {
    icon: Calculator,
    title: 'Cost-ready quantities',
    description:
      'Apply waste, unit costs, and profit targets so measured quantities turn into bid-ready numbers faster.',
    accent: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  },
  {
    icon: FileText,
    title: 'Professional reports',
    description:
      'Package quantities, notes, measurements, and project summaries into clean documentation for your team.',
    accent: 'bg-purple-50 text-purple-600 border-purple-100',
  },
  {
    icon: Layers,
    title: 'Reusable conditions',
    description:
      'Build condition libraries with units, colors, waste factors, and cost assumptions for repeatable work.',
    accent: 'bg-orange-50 text-orange-600 border-orange-100',
  },
  {
    icon: ShieldCheck,
    title: 'Cloud project control',
    description:
      'Keep projects organized, backed up, and available from the office, field, or wherever bid day happens.',
    accent: 'bg-slate-100 text-slate-700 border-slate-200',
  },
];

const workflowSteps = [
  'Upload plans and specs',
  'Measure with calibrated tools',
  'Ask AI about scope and schedules',
  'Export quantities with cost context',
];

const LandingPage: React.FC = () => {
  const navigate = useNavigate();

  const handleLogin = () => {
    navigate('/login');
  };

  const handlePricing = () => {
    navigate('/pricing');
    window.scrollTo(0, 0);
  };

  const handleFeatures = () => {
    document.getElementById('features')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleContact = () => {
    navigate('/contact');
    window.scrollTo(0, 0);
  };

  return (
    <div className="landing-page marketing-page min-h-screen">
      <LandingNav
        links={[
          { label: 'Features', onClick: handleFeatures },
          { label: 'Pricing', onClick: handlePricing },
          { label: 'Contact', onClick: handleContact },
        ]}
        actionButton={{ label: 'Login', onClick: handleLogin }}
      />

      <section className="landing-hero marketing-section">
        <div className="relative z-10 mx-auto max-w-5xl px-4 pb-20 pt-14 text-center sm:px-6 sm:pb-24 sm:pt-20 lg:px-8 lg:pb-28 lg:pt-24">
          <div className="marketing-copy-reveal">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-300/20 bg-white/[0.08] px-4 py-2 text-sm font-semibold text-blue-100 shadow-lg shadow-blue-950/20 backdrop-blur">
              <Sparkles className="h-4 w-4 text-blue-300" />
              AI-powered takeoff for serious estimators
            </div>
            <h1 className="mx-auto max-w-4xl text-5xl font-black tracking-tight text-white sm:text-6xl lg:text-7xl">
              Takeoffs that move from plan to proposal without the friction.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-300 sm:text-xl">
              Meridian combines fast PDF measurement, intelligent project context, and AI document chat
              in one polished workspace built for modern contractors.
            </p>
            <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
              <Button
                onClick={handleLogin}
                size="lg"
                className="marketing-cta-primary h-12 px-7 text-base font-semibold"
              >
                Start Free Trial
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button
                onClick={handleFeatures}
                size="lg"
                variant="outline"
                className="h-12 rounded-lg border-white/20 bg-white/10 px-7 text-base font-semibold text-white shadow-sm backdrop-blur hover:bg-white/20 hover:text-white"
              >
                See the workflow
              </Button>
            </div>
            <div className="mx-auto mt-10 grid max-w-4xl gap-3 text-left text-sm text-slate-200 sm:grid-cols-2 lg:grid-cols-4">
              {workflowSteps.map((item) => (
                <div key={item} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 shadow-lg shadow-slate-950/20 backdrop-blur">
                  <Check className="h-4 w-4 text-emerald-300" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="marketing-section bg-white py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <div className="marketing-kicker mb-5">Everything in one workspace</div>
            <h2 className="text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
              The best parts of the features page, brought into the main story.
            </h2>
            <p className="mt-5 text-lg leading-8 text-slate-600">
              Meridian is built around the actual estimating workflow: understand the documents,
              measure accurately, price confidently, and present clean quantities.
            </p>
          </div>

          <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {featureCards.map(({ icon: Icon, title, description, accent }) => (
              <div key={title} className="premium-card p-7">
                <div className={`mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl border ${accent}`}>
                  <Icon className="h-6 w-6" />
                </div>
                <h3 className="text-xl font-bold text-slate-950">{title}</h3>
                <p className="mt-3 leading-7 text-slate-600">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="marketing-section bg-slate-950 py-20 text-white">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-blue-300/20 bg-blue-400/10 px-4 py-2 text-sm font-semibold text-blue-100">
              <Zap className="h-4 w-4 text-blue-300" />
              AI where estimators need it
            </div>
            <h2 className="text-4xl font-black tracking-tight sm:text-5xl">
              Ask better questions while the plans are still open.
            </h2>
            <p className="mt-5 text-lg leading-8 text-slate-300">
              Use AI to interrogate project documents, catch scope details, summarize schedules,
              and connect answers back to the same takeoff workspace your team already uses.
            </p>
            <div className="mt-8 space-y-4">
              {workflowSteps.map((step, index) => (
                <div key={step} className="flex items-center gap-4">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-500 text-sm font-bold text-white">
                    {index + 1}
                  </div>
                  <span className="text-slate-200">{step}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="premium-card border-slate-800 bg-slate-900 p-5 text-white shadow-2xl">
            <div className="rounded-2xl border border-white/10 bg-slate-950 p-5">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-white">AI takeoff review</div>
                  <div className="text-xs text-slate-400">Plan set A-201 through A-506</div>
                </div>
                <div className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-200">
                  Online
                </div>
              </div>
              <div className="space-y-4">
                <div className="max-w-[86%] rounded-2xl bg-white/10 p-4 text-sm leading-6 text-slate-200">
                  Pull the unit mix from the plans and flag any scope notes that impact flooring.
                </div>
                <div className="ml-auto max-w-[92%] rounded-2xl bg-blue-600 p-4 text-sm leading-6 text-white">
                  I found 18 units across 4 layouts. Two finish notes call for moisture mitigation under LVP in slab-on-grade areas.
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {['Unit Mix', 'Finish Notes', 'Open Questions', 'Report Ready'].map((item) => (
                    <div key={item} className="rounded-xl border border-white/10 bg-white/[0.06] p-3">
                      <Check className="mb-2 h-4 w-4 text-emerald-300" />
                      <div className="text-sm font-semibold text-white">{item}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="marketing-section bg-white py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-6 md:grid-cols-3">
            {[
              ['Faster bids', 'Move from drawings to quantities without bouncing between disconnected tools.'],
              ['Cleaner handoff', 'Keep measurements, assumptions, annotations, and reports in one organized project.'],
              ['Sharper margins', 'Use waste, unit costs, and profit targets before your estimate leaves the workspace.'],
            ].map(([title, description]) => (
              <div key={title} className="rounded-3xl border border-slate-200 bg-slate-50 p-8">
                <h3 className="text-2xl font-black text-slate-950">{title}</h3>
                <p className="mt-3 leading-7 text-slate-600">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="marketing-section bg-blue-600 py-20">
        <div className="mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
          <h2 className="text-4xl font-black tracking-tight text-white sm:text-5xl">
            Bring AI into your next takeoff.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-blue-50">
            Start with a clean, modern estimating workspace that helps you read documents,
            measure quickly, and turn quantities into confident bid decisions.
          </p>
          <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
            <Button
              onClick={handleLogin}
              size="lg"
              className="h-12 rounded-lg bg-white px-7 text-base font-semibold text-blue-700 shadow-xl shadow-blue-950/20 hover:bg-blue-50"
            >
              Start Your Free Trial
            </Button>
            <Button
              onClick={handleContact}
              size="lg"
              variant="outline"
              className="h-12 rounded-lg border-white/40 bg-blue-500 px-7 text-base font-semibold text-white hover:bg-blue-500/80 hover:text-white"
            >
              Schedule a Demo
            </Button>
          </div>
        </div>
      </section>

      <footer className="bg-slate-950 py-12 text-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-8 md:grid-cols-4">
            <div>
              <div className="mb-4 flex items-center gap-3">
                <MeridianBrandMark className="h-9 w-9 text-white" tone="light" />
                <h3 className="text-lg font-semibold">Meridian Takeoff</h3>
              </div>
              <p className="text-slate-400">
                Premium construction takeoff software with AI built into the workflow.
              </p>
            </div>
            <div>
              <h4 className="mb-4 font-semibold">Product</h4>
              <ul className="space-y-2 text-slate-400">
                <li><button onClick={handleFeatures} className="hover:text-white">Features</button></li>
                <li><button onClick={handlePricing} className="hover:text-white">Pricing</button></li>
                <li><a href="/help" className="hover:text-white">Help Center</a></li>
              </ul>
            </div>
            <div>
              <h4 className="mb-4 font-semibold">Use Cases</h4>
              <ul className="space-y-2 text-slate-400">
                <li>PDF takeoffs</li>
                <li>AI document review</li>
                <li>Quantity reporting</li>
              </ul>
            </div>
            <div>
              <h4 className="mb-4 font-semibold">Support</h4>
              <ul className="space-y-2 text-slate-400">
                <li><button onClick={handleContact} className="hover:text-white">Contact</button></li>
                <li><button onClick={handleLogin} className="hover:text-white">Login</button></li>
              </ul>
            </div>
          </div>
          <div className="mt-8 border-t border-slate-800 pt-8 text-center text-slate-400">
            <p>&copy; 2024 Meridian Takeoff. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
