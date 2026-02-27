import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from './ui/button';

const LandingPage: React.FC = () => {
  const navigate = useNavigate();

  const handleLogin = () => {
    navigate('/login');
  };

  const handlePricing = () => {
    navigate('/pricing');
  };

  const handleFeatures = () => {
    navigate('/features');
    window.scrollTo(0, 0);
  };

  const handleContact = () => {
    navigate('/contact');
    window.scrollTo(0, 0);
  };

  return (
    <div className="landing-page min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Navigation - matches footer slate-900 */}
      <nav className="bg-slate-900 border-b border-slate-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <button
                onClick={() => navigate('/')}
                className="flex items-center gap-3 flex-shrink-0 hover:opacity-90 transition-opacity"
                aria-label="Meridian Takeoff home"
              >
                <img
                  src="/logo.png"
                  alt=""
                  className="h-9 w-9 rounded-lg object-contain"
                />
                <h1 className="text-2xl font-bold text-white">
                  Meridian <span className="text-blue-400">Takeoff</span>
                </h1>
              </button>
            </div>
            <div className="flex items-center space-x-4">
              <Button 
                onClick={handleFeatures}
                variant="ghost" 
                className="text-slate-300 hover:text-white hover:bg-slate-800"
              >
                Features
              </Button>
              <Button 
                onClick={handlePricing}
                variant="ghost" 
                className="text-slate-300 hover:text-white hover:bg-slate-800"
              >
                Pricing
              </Button>
              <Button
                onClick={handleContact}
                variant="ghost"
                className="text-slate-300 hover:text-white hover:bg-slate-800"
              >
                Contact
              </Button>
              <Button 
                onClick={handleLogin}
                className="bg-blue-600 hover:bg-blue-500 text-white"
              >
                Login
              </Button>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section - white bg so logo blends cleanly */}
      <section className="relative overflow-hidden bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-16">
          <div className="text-center">
            <div className="flex justify-center mb-8">
              <img
                src="/logo-hero.png"
                alt="Meridian Takeoff"
                className="h-40 w-40 sm:h-48 sm:w-48 md:h-56 md:w-56 lg:h-64 lg:w-64 object-contain"
              />
            </div>
            <h1 className="text-5xl md:text-6xl font-bold text-slate-900 mb-6">
              Streamline Your
              <span className="text-blue-600 block">Construction Takeoffs</span>
            </h1>
            <p className="text-xl text-slate-600 mb-8 max-w-3xl mx-auto">
              Professional-grade takeoff software that combines precision measurement tools 
              with AI-powered document analysis. Chat with your blueprints, get instant answers 
              about your projects, and build faster with intelligent assistance.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button 
                onClick={handleLogin}
                size="lg" 
                className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 text-lg"
              >
                Start Free Trial
              </Button>
              <Button size="lg" variant="outline" className="border-slate-300 text-slate-700 hover:bg-slate-50 px-8 py-3 text-lg">
                Watch Demo
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* AI Chat Feature Highlight */}
      <section className="py-20 bg-gradient-to-r from-blue-50 to-indigo-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="mb-4 bg-blue-100 text-blue-800 border border-blue-200 rounded-full px-4 py-2 text-sm font-medium inline-block">
                🤖 AI-Powered Intelligence
              </div>
              <h2 className="text-4xl font-bold text-slate-900 mb-6">
                Chat with Your Construction Documents
              </h2>
              <p className="text-xl text-slate-600 mb-8">
                Ask questions about your blueprints, specifications, and project details. Our AI assistant 
                understands your documents and provides instant, accurate answers to help you work faster and smarter.
              </p>
              <div className="space-y-4">
                <div className="flex items-start space-x-3">
                  <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-3 h-3 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900">Instant Document Analysis</h3>
                    <p className="text-slate-600">Get answers about measurements, specifications, and project requirements instantly</p>
                  </div>
                </div>
                <div className="flex items-start space-x-3">
                  <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-3 h-3 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900">Smart Project Context</h3>
                    <p className="text-slate-600">AI understands your entire project including measurements, conditions, and documents</p>
                  </div>
                </div>
                <div className="flex items-start space-x-3">
                  <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-3 h-3 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900">Natural Language Queries</h3>
                    <p className="text-slate-600">Ask questions in plain English and get precise, actionable answers</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="relative">
              <div className="bg-white rounded-2xl shadow-2xl p-6 border border-slate-200">
                <div className="flex items-center space-x-3 mb-4">
                  <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                  <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                  <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                  <div className="text-sm text-slate-500 ml-4">AI Chat Assistant</div>
                </div>
                <div className="space-y-4">
                  <div className="flex items-start space-x-3">
                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                      <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                    </div>
                    <div className="bg-slate-100 rounded-lg p-3 max-w-xs">
                      <p className="text-sm text-slate-700">Can you analyze the door schedule and give me a count of all unit types?</p>
                    </div>
                  </div>
                  <div className="flex items-start space-x-3 justify-end">
                    <div className="bg-blue-600 rounded-lg p-3 max-w-xs">
                      <p className="text-sm text-white">I found 12 different door types in your schedule: 6 - 3'0" x 7'0" hollow metal doors, 3 - 2'8" x 6'8" wood doors, 2 - 4'0" x 8'0" overhead doors, and 1 - 3'6" x 7'0" fire-rated door.</p>
                    </div>
                    <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                      <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                    </div>
                  </div>
                  <div className="flex items-start space-x-3">
                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                      <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                    </div>
                    <div className="bg-slate-100 rounded-lg p-3 max-w-xs">
                      <p className="text-sm text-slate-700">What are the key project conditions I should be aware of?</p>
                    </div>
                  </div>
                  <div className="flex items-start space-x-3 justify-end">
                    <div className="bg-blue-600 rounded-lg p-3 max-w-xs">
                      <p className="text-sm text-white">Based on your project conditions, here are the key items: 1) Excavation requires shoring for depths over 8ft, 2) Concrete must meet freeze-thaw durability requirements, 3) All foundation work needs inspection before backfill.</p>
                    </div>
                    <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                      <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                    </div>
                  </div>
                </div>
                <div className="mt-4 pt-4 border-t border-slate-200">
                  <div className="flex items-center space-x-2 text-slate-500">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                    <span className="text-sm">AI Assistant Online</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-slate-900 mb-4">
              Everything You Need for Professional Takeoffs
            </h2>
            <p className="text-xl text-slate-600 max-w-2xl mx-auto">
              Powerful tools designed by construction professionals, for construction professionals.
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="text-center p-6 rounded-lg border border-slate-200 hover:shadow-lg transition-shadow cursor-pointer" onClick={handleFeatures}>
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-slate-900 mb-2">PDF Takeoffs</h3>
              <p className="text-slate-600">
                Import blueprints and drawings directly. Measure areas, lengths, and quantities with precision tools.
              </p>
            </div>

            <div className="text-center p-6 rounded-lg border border-slate-200 hover:shadow-lg transition-shadow cursor-pointer" onClick={handleFeatures}>
              <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-slate-900 mb-2">AI Document Chat</h3>
              <p className="text-slate-600">
                Ask questions about your blueprints and get instant answers. AI understands your project context and documents.
              </p>
            </div>

            <div className="text-center p-6 rounded-lg border border-slate-200 hover:shadow-lg transition-shadow cursor-pointer" onClick={handleFeatures}>
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-slate-900 mb-2">Smart Calculations</h3>
              <p className="text-slate-600">
                Automated quantity calculations with waste factors, material costs, and profit margins. Build accurate project budgets with customizable formulas.
              </p>
            </div>

            <div className="text-center p-6 rounded-lg border border-slate-200 hover:shadow-lg transition-shadow cursor-pointer" onClick={handleFeatures}>
              <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-slate-900 mb-2">Professional Reports</h3>
              <p className="text-slate-600">
                Generate detailed takeoff reports with quantities, measurements, and project summaries for professional documentation.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-blue-600">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-4xl font-bold text-white mb-4">
            Ready to Transform Your Takeoff Process?
          </h2>
          <p className="text-xl text-blue-100 mb-8 max-w-2xl mx-auto">
            Experience the future of construction takeoffs with AI-powered document analysis. 
            Chat with your blueprints, get instant answers, and work smarter than ever before.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button 
              onClick={handleLogin}
              size="lg" 
              className="bg-white text-blue-600 hover:bg-slate-50 px-8 py-3 text-lg"
            >
              Start Your Free Trial
            </Button>
            <Button size="lg" className="bg-white text-blue-600 hover:bg-slate-50 px-8 py-3 text-lg border border-white">
              Schedule a Demo
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-4 gap-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <img
                  src="/logo.png"
                  alt=""
                  className="h-8 w-8 rounded-lg object-contain"
                />
                <h3 className="text-lg font-semibold">Meridian Takeoff</h3>
              </div>
              <p className="text-slate-400">
                Professional construction takeoff software for the modern contractor.
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Product</h4>
              <ul className="space-y-2 text-slate-400">
                <li><a href="#" className="hover:text-white">Features</a></li>
                <li><a href="#" className="hover:text-white">Pricing</a></li>
                <li><a href="#" className="hover:text-white">Integrations</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Support</h4>
              <ul className="space-y-2 text-slate-400">
                <li><a href="#" className="hover:text-white">Help Center</a></li>
                <li><a href="#" className="hover:text-white">Contact Us</a></li>
                <li><a href="#" className="hover:text-white">Training</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Company</h4>
              <ul className="space-y-2 text-slate-400">
                <li><a href="#" className="hover:text-white">About</a></li>
                <li><a href="#" className="hover:text-white">Blog</a></li>
                <li><a href="#" className="hover:text-white">Careers</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-slate-800 mt-8 pt-8 text-center text-slate-400">
            <p>&copy; 2024 Meridian Takeoff. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
