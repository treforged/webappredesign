import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { ArrowRight, BarChart3, Shield, Target, Wallet, Car, Crown } from 'lucide-react';

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.1, duration: 0.4 } }),
};

const features = [
  { icon: Wallet, title: 'Cash Flow Control', desc: 'Track every dollar in and out. See your real-time financial position at a glance.' },
  { icon: BarChart3, title: 'Spending Analytics', desc: 'Break down expenses by category. Identify patterns. Cut waste.' },
  { icon: Shield, title: 'Debt Payoff Engine', desc: 'Snowball or avalanche — compare strategies and crush debt systematically.' },
  { icon: Target, title: 'Savings Goals', desc: 'Set targets, track progress, and watch your financial runway grow.' },
  { icon: Car, title: 'Car Fund Tracker', desc: 'Plan your next vehicle purchase with precision. Know your numbers.' },
  { icon: Crown, title: 'Premium Tools', desc: 'Advanced exports, multiple budgets, and pro-level analytics.' },
];

const testimonials = [
  { name: 'Marcus T.', role: 'Software Engineer', quote: 'Finally a budget app that doesn\'t feel like a toy. TRE Forged takes my finances seriously.' },
  { name: 'Aisha K.', role: 'Content Creator', quote: 'The car fund tracker alone sold me. I knew exactly when I could pull the trigger on my dream car.' },
  { name: 'Devon R.', role: 'Freelance Designer', quote: 'Clean, fast, no fluff. I opened the app and immediately knew what I was working with.' },
];

export default function Landing() {
  const { setIsDemo } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <span className="font-display font-bold text-sm tracking-tight text-gold">TRE FORGED</span>
          <div className="flex items-center gap-4">
            <Link to="/auth" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Sign In
            </Link>
            <Link
              to="/auth"
              className="text-xs font-medium bg-primary text-primary-foreground px-4 py-1.5 btn-press transition-colors hover:bg-primary/90"
              style={{ borderRadius: 'var(--radius)' }}
            >
              Start Free
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 py-24 lg:py-32 text-center">
        <motion.h1
          className="font-display font-extrabold text-4xl md:text-6xl lg:text-7xl tracking-tight text-foreground"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          Discipline builds<br />
          <span className="text-gold">wealth.</span>
        </motion.h1>
        <motion.p
          className="mt-6 text-base md:text-lg text-muted-foreground max-w-xl mx-auto"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.5 }}
        >
          Budget with precision. Eliminate debt. Stack savings. Track every goal.
          TRE Forged is the financial cockpit for people who take their money seriously.
        </motion.p>
        <motion.div
          className="mt-10 flex items-center justify-center gap-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.5 }}
        >
          <Link
            to="/auth"
            className="flex items-center gap-2 bg-primary text-primary-foreground px-6 py-2.5 text-sm font-semibold btn-press transition-colors hover:bg-primary/90"
            style={{ borderRadius: 'var(--radius)' }}
          >
            Start Free <ArrowRight size={14} />
          </Link>
          <Link
            to="/dashboard"
            onClick={() => setIsDemo(true)}
            className="flex items-center gap-2 border border-border text-foreground px-6 py-2.5 text-sm font-semibold btn-press transition-colors hover:bg-accent"
            style={{ borderRadius: 'var(--radius)' }}
          >
            See Demo
          </Link>
        </motion.div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-4 py-20 border-t border-border">
        <h2 className="font-display font-bold text-2xl md:text-3xl text-center mb-4 tracking-tight">
          Built for financial discipline
        </h2>
        <p className="text-sm text-muted-foreground text-center mb-12 max-w-md mx-auto">
          Every tool designed to give you clarity, control, and confidence over your money.
        </p>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              className="card-forged p-6"
              custom={i}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeUp}
            >
              <f.icon size={20} className="text-gold mb-3" />
              <h3 className="font-display font-semibold text-sm mb-1">{f.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Testimonials */}
      <section className="max-w-6xl mx-auto px-4 py-20 border-t border-border">
        <h2 className="font-display font-bold text-2xl md:text-3xl text-center mb-12 tracking-tight">
          Trusted by disciplined professionals
        </h2>
        <div className="grid md:grid-cols-3 gap-4">
          {testimonials.map((t, i) => (
            <motion.div
              key={t.name}
              className="card-forged p-6"
              custom={i}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeUp}
            >
              <p className="text-xs text-muted-foreground leading-relaxed italic mb-4">"{t.quote}"</p>
              <p className="text-xs font-semibold text-foreground">{t.name}</p>
              <p className="text-[10px] text-muted-foreground">{t.role}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="max-w-6xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <span className="font-display font-bold text-xs tracking-tight text-gold">TRE FORGED BUDGET OS</span>
          <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
            <span>&copy; {new Date().getFullYear()} TRE Forged LLC. All rights reserved.</span>
            <Link to="/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">Privacy Policy</Link>
            <Link to="/terms" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">Terms of Service</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
