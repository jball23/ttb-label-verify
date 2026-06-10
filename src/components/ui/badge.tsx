import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 [&_svg]:size-3 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-border text-foreground',
        success:
          'border-transparent bg-[color-mix(in_srgb,var(--success)_18%,transparent)] text-[oklch(0.45_0.16_152)] dark:text-[oklch(0.85_0.18_152)]',
        warning:
          'border-transparent bg-[color-mix(in_srgb,var(--warning)_22%,transparent)] text-[oklch(0.5_0.16_75)] dark:text-[oklch(0.88_0.17_75)]',
        destructive:
          'border-transparent bg-[color-mix(in_srgb,var(--destructive)_20%,transparent)] text-[oklch(0.5_0.22_25)] dark:text-[oklch(0.85_0.22_25)]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
