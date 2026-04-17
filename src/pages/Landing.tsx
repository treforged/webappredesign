import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useMotionValue, useSpring, type Variants } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { ArrowRight, BarChart3, Shield, Target, Wallet, Car, Crown, TrendingUp, Lock, Zap } from 'lucide-react';

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.08, duration: 0.45 } }),
};

const features = [
  { icon: Wallet, title: 'Cash Flow Control', desc: 'Track every dollar in and out. See your real-time financial position at a glance.' },
  { icon: BarChart3, title: 'Spending Analytics', desc: 'Break down expenses by category. Identify patterns. Cut waste.' },
  { icon: Shield, title: 'Debt Payoff Engine', desc: 'Snowball or avalanche — compare strategies and crush debt systematically.' },
  { icon: Target, title: 'Savings Goals', desc: 'Set targets, track progress, and watch your financial runway grow.' },
  { icon: Car, title: 'Car Fund Tracker', desc: 'Plan your next vehicle purchase with precision. Know your numbers.' },
  { icon: Crown, title: 'Premium Tools', desc: 'Advanced exports, unlimited history, and pro-level analytics.' },
];

const stats = [
  { value: 12, suffix: '+', label: 'Financial Tools' },
  { value: 100, suffix: '%', label: 'Free to Start' },
  { value: 0, suffix: ' ads', label: 'Ever' },
];

const pillars = [
  { icon: TrendingUp, title: 'Track', desc: 'Every account, goal, and payment — one dashboard.' },
  { icon: Lock, title: 'Secure', desc: 'Bank-level encryption. MFA. Your data never sold.' },
  { icon: Zap, title: 'Automate', desc: 'Recurring rules, paycheck scheduling, auto-projection.' },
];

const testimonials = [
  { name: 'Marcus T.', role: 'Software Engineer', quote: 'Finally a budget app that doesn\'t feel like a toy. Forged takes my finances seriously.' },
  { name: 'Aisha K.', role: 'Content Creator', quote: 'The car fund tracker alone sold me. I knew exactly when I could pull the trigger on my dream car.' },
  { name: 'Devon R.', role: 'Freelance Designer', quote: 'Clean, fast, no fluff. I opened the app and immediately knew what I was working with.' },
];

function AnimatedCounter({ target, suffix }: { target: number; suffix: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const observed = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !observed.current) {
        observed.current = true;
        const duration = 1200;
        const start = performance.now();
        const animate = (now: number) => {
          const elapsed = now - start;
          const progress = Math.min(elapsed / duration, 1);
          const eased = 1 - Math.pow(1 - progress, 3);
          setCount(Math.round(eased * target));
          if (progress < 1) requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
      }
    }, { threshold: 0.5 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [target]);

  return <span ref={ref}>{count}{suffix}</span>;
}

export default function Landing() {
  const { setIsDemo } = useAuth();
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref) sessionStorage.setItem('forged:ref', ref);
  }, []);
  const springX = useSpring(mouseX, { stiffness: 60, damping: 20 });
  const springY = useSpring(mouseY, { stiffness: 60, damping: 20 });

  const handleMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    mouseX.set(((e.clientX - rect.left) / rect.width - 0.5) * 20);
    mouseY.set(((e.clientY - rect.top) / rect.height - 0.5) * 20);
  };

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      {/* Nav */}
      <motion.header
        className="border-b border-border sticky top-0 z-40 bg-background/90 backdrop-blur-sm"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <motion.span
            className="font-display font-bold text-sm tracking-tight text-gold"
            whileHover={{ scale: 1.04 }}
          >
            FORGED
          </motion.span>
          <div className="flex items-center gap-4">
            <Link to="/auth" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Sign In
            </Link>
            <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
              <Link
                to="/auth"
                className="text-xs font-medium bg-primary text-primary-foreground px-4 py-1.5 btn-press transition-colors hover:bg-primary/90"
                style={{ borderRadius: 'var(--radius)' }}
              >
                Start Free
              </Link>
            </motion.div>
          </div>
        </div>
      </motion.header>

      {/* Hero */}
      <section
        className="max-w-6xl mx-auto px-4 py-24 lg:py-36 text-center relative"
        onMouseMove={handleMouseMove}
      >
        {/* Ambient glow */}
        <motion.div
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
          style={{ x: springX, y: springY }}
        >
          <div className="w-[600px] h-[600px] rounded-full bg-primary/5 blur-3xl" />
        </motion.div>

        <motion.div
          className="inline-flex items-center gap-2 border border-primary/30 bg-primary/5 text-primary px-3 py-1 text-[10px] font-semibold tracking-wider uppercase mb-6"
          style={{ borderRadius: 'var(--radius)' }}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
        >
          <Zap size={9} /> Personal Finance, Engineered
        </motion.div>

        <motion.h1
          className="font-display font-extrabold text-4xl md:text-6xl lg:text-7xl tracking-tight text-foreground relative"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.05 }}
        >
          Discipline builds<br />
          <span className="text-gold">wealth.</span>
        </motion.h1>

        <motion.p
          className="mt-6 text-base md:text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.5 }}
        >
          Budget with precision. Eliminate debt. Stack savings. Track every goal.
          Forged is the financial cockpit for people who take their money seriously.
        </motion.p>

        <motion.div
          className="mt-10 flex items-center justify-center gap-4 flex-wrap"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.5 }}
        >
          <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}>
            <Link
              to="/auth"
              className="flex items-center gap-2 bg-primary text-primary-foreground px-6 py-2.5 text-sm font-semibold btn-press transition-colors hover:bg-primary/90"
              style={{ borderRadius: 'var(--radius)' }}
            >
              Start Free <ArrowRight size={14} />
            </Link>
          </motion.div>
          <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
            <Link
              to="/dashboard"
              onClick={() => setIsDemo(true)}
              className="flex items-center gap-2 border border-border text-foreground px-6 py-2.5 text-sm font-semibold btn-press transition-colors hover:bg-accent"
              style={{ borderRadius: 'var(--radius)' }}
            >
              See Demo
            </Link>
          </motion.div>
        </motion.div>
      </section>

      {/* Stats */}
      <section className="border-t border-b border-border py-12 bg-secondary/20">
        <div className="max-w-6xl mx-auto px-4">
          <div className="grid grid-cols-3 gap-6 text-center">
            {stats.map((s, i) => (
              <motion.div
                key={s.label}
                custom={i}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                variants={fadeUp}
              >
                <p className="font-display font-extrabold text-3xl md:text-4xl text-gold">
                  <AnimatedCounter target={s.value} suffix={s.suffix} />
                </p>
                <p className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wider">{s.label}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Pillars */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <div className="grid md:grid-cols-3 gap-4">
          {pillars.map((p, i) => (
            <motion.div
              key={p.title}
              className="card-forged p-5 flex items-start gap-4 group hover:border-primary/30 transition-colors"
              custom={i}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeUp}
              whileHover={{ y: -2 }}
            >
              <div className="p-2 bg-primary/10 border border-primary/20 shrink-0" style={{ borderRadius: 'var(--radius)' }}>
                <p.icon size={16} className="text-primary" />
              </div>
              <div>
                <h3 className="font-display font-bold text-sm mb-1 group-hover:text-primary transition-colors">{p.title}</h3>
                <p className="text-[11px] text-muted-foreground leading-relaxed">{p.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-4 py-20 border-t border-border">
        <motion.div
          className="text-center mb-12"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={fadeUp}
          custom={0}
        >
          <h2 className="font-display font-bold text-2xl md:text-3xl tracking-tight mb-3">
            Built for financial discipline
          </h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Every tool designed to give you clarity, control, and confidence over your money.
          </p>
        </motion.div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              className="card-forged p-6 group hover:border-primary/25 transition-all duration-300 cursor-default"
              custom={i}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeUp}
              whileHover={{ y: -3, transition: { duration: 0.2 } }}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="p-1.5 bg-gold/10 border border-gold/20" style={{ borderRadius: 'var(--radius)' }}>
                  <f.icon size={15} className="text-gold" />
                </div>
                <h3 className="font-display font-semibold text-sm group-hover:text-primary transition-colors">{f.title}</h3>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Testimonials */}
      <section className="max-w-6xl mx-auto px-4 py-20 border-t border-border">
        <motion.h2
          className="font-display font-bold text-2xl md:text-3xl text-center mb-12 tracking-tight"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={fadeUp}
          custom={0}
        >
          Trusted by disciplined professionals
        </motion.h2>
        <div className="grid md:grid-cols-3 gap-4">
          {testimonials.map((t, i) => (
            <motion.div
              key={t.name}
              className="card-forged p-6 group hover:border-primary/20 transition-all"
              custom={i}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeUp}
              whileHover={{ y: -2 }}
            >
              <div className="flex gap-0.5 mb-3">
                {[...Array(5)].map((_, j) => (
                  <span key={j} className="text-gold text-xs">★</span>
                ))}
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed italic mb-4">"{t.quote}"</p>
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center text-[10px] font-bold text-primary">
                  {t.name[0]}
                </div>
                <div>
                  <p className="text-xs font-semibold text-foreground">{t.name}</p>
                  <p className="text-[10px] text-muted-foreground">{t.role}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border py-20 bg-secondary/10">
        <motion.div
          className="max-w-xl mx-auto px-4 text-center"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={fadeUp}
          custom={0}
        >
          <h2 className="font-display font-bold text-2xl md:text-3xl tracking-tight mb-4">
            Start building wealth today.
          </h2>
          <p className="text-sm text-muted-foreground mb-8">
            Free to start. No credit card. No ads. Just your money, finally under control.
          </p>
          <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}>
            <Link
              to="/auth"
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-3 text-sm font-semibold btn-press transition-colors hover:bg-primary/90"
              style={{ borderRadius: 'var(--radius)' }}
            >
              Get Started Free <ArrowRight size={14} />
            </Link>
          </motion.div>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="max-w-6xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <span className="font-display font-bold text-xs tracking-tight text-gold">FORGED</span>
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
