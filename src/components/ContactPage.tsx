import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { toast } from 'sonner';
import { getApiBaseUrl } from '../lib/apiConfig';

const ContactPage: React.FC = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company: '',
    subject: '',
    message: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleBackToHome = () => {
    navigate('/');
  };

  const handleFeatures = () => {
    navigate('/features');
    window.scrollTo(0, 0);
  };

  const handlePricing = () => {
    navigate('/pricing');
    window.scrollTo(0, 0);
  };

  const handleContact = () => {
    navigate('/contact');
    window.scrollTo(0, 0);
  };

  const handleLogin = () => {
    navigate('/login');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const res = await fetch(`${getApiBaseUrl()}/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to send message');
      }
      toast.success("Thanks for reaching out! We'll be in touch soon.");
      setFormData({ name: '', email: '', company: '', subject: '', message: '' });
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="contact-page min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Navigation - matches landing page */}
      <nav className="bg-slate-900 border-b border-slate-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <button
                onClick={handleBackToHome}
                className="flex items-center gap-3 flex-shrink-0 hover:opacity-90 transition-opacity"
                aria-label="Meridian Takeoff home"
              >
                <img src="/logo.png" alt="" className="h-9 w-9 rounded-lg object-contain" />
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

      {/* Hero Section - slate-50 to differentiate from white content sections */}
      <section className="relative overflow-hidden bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-16">
          <div className="text-center">
            <div className="mb-6 bg-blue-100 text-blue-800 border border-blue-200 rounded-full px-4 py-2 text-sm font-medium inline-block">
              Get in Touch
            </div>
            <h1 className="text-5xl md:text-6xl font-bold text-slate-900 mb-6">
              We&apos;d Love to
              <span className="text-blue-600 block">Hear From You</span>
            </h1>
            <p className="text-xl text-slate-600 mb-8 max-w-3xl mx-auto">
              Have questions about Meridian Takeoff? Need a demo? Interested in enterprise pricing?
              Send us a message and our team will get back to you shortly.
            </p>
          </div>
        </div>
      </section>

      {/* Contact Form & Info */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-start">
            <div>
              <h2 className="text-3xl font-bold text-slate-900 mb-6">Send us a message</h2>
              <p className="text-slate-600 mb-8">
                Fill out the form below and we&apos;ll respond within one business day.
              </p>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid sm:grid-cols-2 gap-6">
                  <div>
                    <Label htmlFor="name">Name</Label>
                    <Input
                      id="name"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="Your name"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      required
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      placeholder="you@company.com"
                      className="mt-1"
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="company">Company (optional)</Label>
                  <Input
                    id="company"
                    value={formData.company}
                    onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                    placeholder="Your company"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="subject">Subject</Label>
                  <Input
                    id="subject"
                    required
                    value={formData.subject}
                    onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                    placeholder="How can we help?"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="message">Message</Label>
                  <Textarea
                    id="message"
                    required
                    rows={5}
                    value={formData.message}
                    onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                    placeholder="Tell us about your project or question..."
                    className="mt-1"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3"
                >
                  {isSubmitting ? 'Sending...' : 'Send message'}
                </Button>
              </form>
            </div>
            <div className="lg:pl-8">
              <h3 className="text-xl font-semibold text-slate-900 mb-6">Other ways to reach us</h3>
              <div className="space-y-6">
                <div>
                  <h4 className="font-medium text-slate-900 mb-2">Sales & demos</h4>
                  <p className="text-slate-600">
                    Interested in seeing Meridian Takeoff in action? Schedule a personalized demo 
                    with our team to see how it can streamline your takeoff process.
                  </p>
                </div>
                <div>
                  <h4 className="font-medium text-slate-900 mb-2">Support</h4>
                  <p className="text-slate-600">
                    Existing customers can reach our support team through the app. We typically 
                    respond within a few hours during business hours.
                  </p>
                </div>
                <div>
                  <h4 className="font-medium text-slate-900 mb-2">Enterprise</h4>
                  <p className="text-slate-600">
                    For large teams, custom integrations, or volume pricing, our enterprise team 
                    is here to help design a solution that fits your needs.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-4 gap-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <img src="/logo.png" alt="" className="h-8 w-8 rounded-lg object-contain" />
                <h3 className="text-lg font-semibold">Meridian Takeoff</h3>
              </div>
              <p className="text-slate-400">
                Professional construction takeoff software for the modern contractor.
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Product</h4>
              <ul className="space-y-2 text-slate-400">
                <li><Link to="/features" className="hover:text-white">Features</Link></li>
                <li><Link to="/pricing" className="hover:text-white">Pricing</Link></li>
                <li><Link to="/contact" className="hover:text-white">Contact</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Support</h4>
              <ul className="space-y-2 text-slate-400">
                <li><Link to="/contact" className="hover:text-white">Help Center</Link></li>
                <li><Link to="/contact" className="hover:text-white">Contact Us</Link></li>
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

export default ContactPage;
