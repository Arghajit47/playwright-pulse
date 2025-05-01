'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';

export default function SettingsPage() {
  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl font-bold tracking-tight">Settings</CardTitle>
          <CardDescription>Manage your Playwright Pulse configuration and preferences.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">

          {/* General Settings */}
          <div className="space-y-4">
             <h3 className="text-lg font-medium">General</h3>
              <div className="space-y-2">
                <Label htmlFor="projectName">Project Name</Label>
                <Input id="projectName" placeholder="My Awesome Project" defaultValue="Playwright Pulse Demo" />
                <p className="text-xs text-muted-foreground">The display name for your project in the report.</p>
              </div>
              <div className="flex items-center space-x-2">
                 <Switch id="darkMode" />
                 <Label htmlFor="darkMode">Enable Dark Mode</Label>
             </div>
          </div>

          <Separator />

           {/* Reporting Settings */}
          <div className="space-y-4">
             <h3 className="text-lg font-medium">Reporting</h3>
             <div className="flex items-center space-x-2">
                 <Switch id="autoRefresh" disabled />
                 <Label htmlFor="autoRefresh">Auto-refresh reports (Coming Soon)</Label>
             </div>
              <div className="space-y-2">
                <Label htmlFor="defaultRuns">Default Runs Shown</Label>
                 <Input id="defaultRuns" type="number" defaultValue={10} min={1} max={50} />
                 <p className="text-xs text-muted-foreground">Number of recent runs displayed by default.</p>
             </div>
          </div>

           <Separator />

           {/* AI Analysis Settings */}
            <div className="space-y-4">
                <h3 className="text-lg font-medium">AI Analysis</h3>
                <div className="space-y-2">
                    <Label htmlFor="aiModel">AI Model (Read-only)</Label>
                    <Input id="aiModel" value="googleai/gemini-2.0-flash" readOnly />
                    <p className="text-xs text-muted-foreground">The underlying AI model used for failure analysis.</p>
                </div>
                {/* Add API Key input if required and not handled by env vars */}
                {/*
                <div className="space-y-2">
                    <Label htmlFor="apiKey">Google AI API Key</Label>
                    <Input id="apiKey" type="password" placeholder="Enter your API Key" />
                     <p className="text-xs text-muted-foreground">Required for AI features. Handled via environment variables ideally.</p>
                 </div>
                 */}
            </div>

           <Separator />

          <div className="flex justify-end">
             <Button disabled>Save Changes (Coming Soon)</Button>
          </div>

        </CardContent>
      </Card>
    </div>
  );
}
