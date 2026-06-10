'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';
import { Sun, Moon, Monitor, Check } from 'lucide-react';
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownTrigger,
} from '@/components/ui/dropdown';

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const showIcon = mounted ? resolvedTheme : 'light';

  return (
    <Dropdown>
      <DropdownTrigger
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-sm font-medium transition-all hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Toggle theme"
      >
        {showIcon === 'dark' ? <Moon className="size-4" /> : <Sun className="size-4" />}
      </DropdownTrigger>
      <DropdownContent>
        <DropdownItem onSelect={() => setTheme('light')}>
          <Sun className="size-4" />
          <span className="flex-1 text-left">Light</span>
          {theme === 'light' && <Check className="size-3.5 text-muted-foreground" />}
        </DropdownItem>
        <DropdownItem onSelect={() => setTheme('dark')}>
          <Moon className="size-4" />
          <span className="flex-1 text-left">Dark</span>
          {theme === 'dark' && <Check className="size-3.5 text-muted-foreground" />}
        </DropdownItem>
        <DropdownItem onSelect={() => setTheme('system')}>
          <Monitor className="size-4" />
          <span className="flex-1 text-left">System</span>
          {theme === 'system' && <Check className="size-3.5 text-muted-foreground" />}
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  );
}
