import type { TestStatus } from '@/types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  CheckCircle,
  XCircle,
  SkipForward,
  AlertCircle,
  AlertTriangle,
  SkipBack,
} from "lucide-react";

interface TestStatusBadgeProps {
  status: TestStatus;
  className?: string;
}

const statusConfig: Record<
  TestStatus,
  { label: string; className: string; icon: React.ElementType }
> = {
  passed: {
    label: "Passed",
    className:
      "bg-green-100 text-green-800 border-green-300 hover:bg-green-200",
    icon: CheckCircle,
  },
  failed: {
    label: "Failed",
    className: "bg-red-100 text-red-800 border-red-300 hover:bg-red-200",
    icon: XCircle,
  },
  skipped: {
    label: "Skipped",
    className:
      "bg-yellow-100 text-yellow-800 border-yellow-300 hover:bg-yellow-200",
    icon: SkipForward,
  },
  "expected-failure": {
    label: "Expected Failure",
    className: "bg-purple-100 text-purple-800",
    icon: AlertCircle, // or any other appropriate icon
  },
  "unexpected-success": {
    label: "Unexpected Pass",
    className: "bg-orange-100 text-orange-800",
    icon: AlertTriangle,
  },
  "explicitly-skipped": {
    label: "Explicitly Skipped",
    className: "bg-blue-100 text-blue-800",
    icon: SkipBack,
  },
};

export function TestStatusBadge({ status, className }: TestStatusBadgeProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <Badge variant="outline" className={cn('capitalize font-medium text-xs px-2.5 py-1', config.className, className)}>
      <Icon className="mr-1 h-3 w-3" />
      {config.label}
    </Badge>
  );
}
