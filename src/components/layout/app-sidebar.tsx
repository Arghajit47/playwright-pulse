'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, Bug, ClipboardList, FileText, Github, History, Home, Settings } from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
} from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';

const menuItems = [
  { href: '/', label: 'Dashboard', icon: Home },
  { href: '/runs', label: 'Test Runs', icon: History },
  { href: '/tests', label: 'All Tests', icon: ClipboardList },
  { href: '/trends', label: 'Trends', icon: BarChart3 },
  { href: '/analysis', label: 'AI Analysis', icon: Bug },
];

const bottomMenuItems = [
    { href: '/settings', label: 'Settings', icon: Settings },
    { href: 'https://github.com/your-repo', label: 'View on GitHub', icon: Github, external: true }, // Add external link example
];


export function AppSidebar() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/') {
        return pathname === href;
    }
    return pathname.startsWith(href);
  };

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border">
        <Link href="/" className="flex items-center gap-2 p-2">
          {/* Placeholder for a logo if desired */}
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-accent">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z" />
             <path fillRule="evenodd" d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2ZM9.03 8.03l1.414-1.414L12 8.172l1.556-1.556 1.414 1.414L13.414 9.5l1.556 1.556-1.414 1.414L12 11.328l-1.556 1.556-1.414-1.414L10.586 9.5 9.03 8.03Zm4.526 6.526L12 13.001l-1.556 1.555-1.414-1.414L10.586 11.5l-1.556-1.556 1.414-1.414L12 10.086l1.556-1.556 1.414 1.414L13.414 11.5l1.556 1.556-1.414 1.414Z" clipRule="evenodd" />

          </svg>
          <span className="font-semibold text-lg text-sidebar-foreground">Playwright Pulse</span>
        </Link>
      </SidebarHeader>
      <SidebarContent className="flex-1 overflow-y-auto p-0">
        <SidebarMenu>
          {menuItems.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                asChild
                isActive={isActive(item.href)}
                className="justify-start transition-default"
                tooltip={item.label}
              >
                <Link href={item.href}>
                  <item.icon className="mr-2 h-5 w-5 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border mt-auto">
        <SidebarMenu>
          {bottomMenuItems.map((item) => (
            <SidebarMenuItem key={item.label}>
              <SidebarMenuButton
                asChild
                isActive={isActive(item.href)}
                className="justify-start transition-default"
                tooltip={item.label}
              >
                 <Link href={item.href} target={item.external ? "_blank" : undefined} rel={item.external ? "noopener noreferrer" : undefined}>
                  <item.icon className="mr-2 h-5 w-5 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
