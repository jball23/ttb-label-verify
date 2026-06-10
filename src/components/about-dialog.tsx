'use client';

import { useState } from 'react';
import { Info, ShieldCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function AboutDialog() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="text-muted-foreground hover:text-foreground"
      >
        <Info className="size-4" />
        About
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogHeader>
          <div className="mb-3 inline-flex size-9 items-center justify-center rounded-md bg-muted">
            <ShieldCheck className="size-4 text-foreground" />
          </div>
          <DialogTitle>About this tool</DialogTitle>
          <DialogDescription>
            A prototype for AI-assisted TTB label compliance checks.
          </DialogDescription>
        </DialogHeader>
        <DialogContent className="space-y-4">
          <p className="text-muted-foreground">
            Upload one or more alcohol-label images. The tool extracts the regulated
            fields with vision AI and validates them against TTB rules.
          </p>
          <div className="rounded-lg border border-border bg-muted/40 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              What this tool does NOT do
            </p>
            <ul className="space-y-1.5 text-sm">
              <li className="flex gap-2">
                <X className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                Store uploaded images (in-memory only)
              </li>
              <li className="flex gap-2">
                <X className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                Store any personally identifiable information
              </li>
              <li className="flex gap-2">
                <X className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                Submit labels to COLA
              </li>
              <li className="flex gap-2">
                <X className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                Replace human compliance review
              </li>
            </ul>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
