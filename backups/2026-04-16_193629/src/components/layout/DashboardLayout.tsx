import { Outlet, Link } from 'react-router-dom';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import DemoBanner from '@/components/shared/DemoBanner';

export default function DashboardLayout() {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col min-h-screen">
        <DemoBanner />
        <main className="flex-1 pb-20 lg:pb-0">
          <Outlet />
        </main>
        <footer className="block border-t border-border py-4 px-6 mb-16 lg:mb-0">
          <div className="flex items-center justify-center gap-4 text-[10px] text-muted-foreground">
            <span>&copy; {new Date().getFullYear()} TRE Forged LLC. All rights reserved.</span>
            <Link to="/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">Privacy Policy</Link>
            <Link to="/terms" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">Terms of Service</Link>
          </div>
        </footer>
      </div>
      <MobileNav />
    </div>
  );
}
