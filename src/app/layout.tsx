import type { Metadata } from 'next';
import { Inter } from 'next/font/google'; // Use Inter font as Geist is not installed
import './globals.css';
import { cn } from '@/lib/utils';
import { Toaster } from '@/components/ui/toaster';
import { AppSidebar } from '@/components/layout/app-sidebar'; // Create this component
import { AppHeader } from '@/components/layout/app-header'; // Create this component
import { SidebarProvider } from '@/components/ui/sidebar';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' }); // Configure Inter font

export const metadata: Metadata = {
  title: 'Playwright Pulse - Test Reporting',
  description: 'Visualize and analyze your Playwright test results.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={cn(
          'min-h-screen bg-background font-sans antialiased',
          inter.variable // Apply Inter font variable
        )}
      >
        <SidebarProvider>
          <div className="flex min-h-screen">
            <AppSidebar />
            <div className="flex flex-1 flex-col">
              <AppHeader />
              <main className="flex-1 p-4 md:p-6 lg:p-8">{children}</main>
            </div>
          </div>
        </SidebarProvider>
        <Toaster />
      </body>
    </html>
  );
}
