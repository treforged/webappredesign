import { Outlet, Link } from 'react-router-dom';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import DemoBanner from '@/components/shared/DemoBanner';

export default function DashboardLayout() {
  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      <Sidebar />

      <div className="flex-1 flex min-h-0 flex-col">
        <div className="sticky top-0 z-40 bg-background">
          <DemoBanner />
        </div>

        <main
          className="
            flex-1
            min-h-0
            overflow-y-auto
            px-3
            pb-[calc(5.5rem+env(safe-area-inset-bottom))]
            pt-[max(0.75rem,env(safe-area-inset-top))]
            sm:px-4
            lg:px-6
            lg:pb-8
            lg:pt-4
          "
          style={{ touchAction: 'pan-y' }}
        >
          <div style={{ overflow: 'hidden' }}>
            <Outlet />
          </div>
        </main>

        <footer className="hidden lg:block border-t border-border py-4 px-6">
          <div className="flex items-center justify-center gap-4 text-[10px] text-muted-foreground">
            <span>&copy; {new Date().getFullYear()} Forged by TRE Forged LLC. All rights reserved.</span>
            <Link to="/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">
              Privacy Policy
            </Link>
            <Link to="/terms" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">
              Terms of Service
            </Link>
          </div>
        </footer>
      </div>

      <MobileNav />
    </div>
  );
}