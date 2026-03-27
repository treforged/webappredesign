import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';

export default function DashboardLayout() {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col min-h-screen">
        <main className="flex-1 pb-20 lg:pb-0">
          <Outlet />
        </main>
        <footer className="hidden lg:block border-t border-border py-4 px-6">
          <p className="text-[10px] text-muted-foreground text-center">
            &copy; {new Date().getFullYear()} TRE Forged LLC. All rights reserved.
          </p>
        </footer>
      </div>
      <MobileNav />
    </div>
  );
}
