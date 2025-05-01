import Link from 'next/link';
import type { TestResult } from '@/types';
import { TestStatusBadge } from './test-status-badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { formatDistanceToNow } from 'date-fns';
import { Clock, Tag, Code } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TestResultItemProps {
  result: TestResult;
  viewMode?: 'list' | 'card'; // Optional: control display style
}

export function TestResultItem({ result, viewMode = 'list' }: TestResultItemProps) {
  const timeAgo = formatDistanceToNow(result.endTime, { addSuffix: true });
  const durationSeconds = (result.duration / 1000).toFixed(2);

  const renderContent = () => (
    <>
        <div className="flex items-center justify-between mb-2">
            <TestStatusBadge status={result.status} />
             <div className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {durationSeconds}s
             </div>
        </div>
        <p className="font-medium text-sm group-hover:text-accent transition-colors">
            {result.name}
        </p>
        {result.suiteName && (
           <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
              <Code className="h-3 w-3" /> Suite: {result.suiteName}
           </p>
        )}
         {result.tags && result.tags.length > 0 && (
             <div className="mt-2 flex flex-wrap gap-1">
                 {result.tags.map(tag => (
                      <span key={tag} className="text-xs bg-secondary px-1.5 py-0.5 rounded">
                         <Tag className="inline h-3 w-3 mr-1" />{tag}
                      </span>
                 ))}
             </div>
         )}
         {result.status === 'failed' && result.errorMessage && (
            <p className="text-xs text-destructive mt-2 line-clamp-2">
              {result.errorMessage}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-2 text-right">Finished {timeAgo}</p>
    </>
  );

  if (viewMode === 'card') {
    return (
      <Link href={`/tests/${result.id}`} className="block group">
        <Card className="hover:shadow-md transition-shadow duration-200 h-full flex flex-col">
          <CardContent className="p-4 flex-1">
             {renderContent()}
          </CardContent>
        </Card>
      </Link>
    );
  }

  // Default to list view (can be used in a table row later)
  return (
    <Link href={`/tests/${result.id}`} className="block p-4 border-b hover:bg-muted/50 transition-colors group">
        {renderContent()}
    </Link>
  );
}
