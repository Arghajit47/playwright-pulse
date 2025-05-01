'use client';

import { SidebarTrigger } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Bell, UserCircle } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function AppHeader() {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-background px-4 sm:static sm:h-auto sm:border-0 sm:bg-transparent sm:px-6">
       {/* Sidebar Trigger for mobile/collapsible */}
       <SidebarTrigger className="md:hidden" />

       {/* Could add Breadcrumbs or Page Title here */}
       <div className="flex-1">
         {/* Example: Page Title - Could be dynamic */}
         {/* <h1 className="text-lg font-semibold">Dashboard</h1> */}
       </div>

       <div className="flex items-center gap-4">
         <Button variant="ghost" size="icon" className="rounded-full">
           <Bell className="h-5 w-5" />
           <span className="sr-only">Notifications</span>
         </Button>
         <DropdownMenu>
           <DropdownMenuTrigger asChild>
             <Button variant="ghost" size="icon" className="rounded-full">
                <UserCircle className="h-6 w-6" />
               <span className="sr-only">User Menu</span>
             </Button>
           </DropdownMenuTrigger>
           <DropdownMenuContent align="end">
             <DropdownMenuLabel>My Account</DropdownMenuLabel>
             <DropdownMenuSeparator />
             <DropdownMenuItem>Settings</DropdownMenuItem>
             <DropdownMenuItem>Support</DropdownMenuItem>
             <DropdownMenuSeparator />
             <DropdownMenuItem>Logout</DropdownMenuItem>
           </DropdownMenuContent>
         </DropdownMenu>
       </div>
    </header>
  );
}
