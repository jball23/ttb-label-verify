'use client';

import { useState } from 'react';
import { Pencil, SearchCheck, ShieldCheck, X } from 'lucide-react';
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
        About
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogHeader>
          <div className="mb-3 inline-flex size-9 items-center justify-center rounded-md bg-muted">
            <ShieldCheck className="size-4 text-foreground" />
          </div>
          <DialogTitle>About this tool</DialogTitle>
          <DialogDescription>
            A prototype that checks alcohol beverage labels against TTB requirements.
          </DialogDescription>
        </DialogHeader>
        <DialogContent className="space-y-4">
          <p className="text-muted-foreground">
            Drop in label photos. Each one is read by an AI model in a couple of seconds and
            checked against the TTB rules every label must meet. A person always makes the
            final decision.
          </p>
          <div className="rounded-lg border border-border bg-muted/40 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              What is checked
            </p>
            <ul className="space-y-2 text-sm">
              <li className="flex gap-2">
                <SearchCheck aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                The government warning, word for word, with &ldquo;GOVERNMENT WARNING:&rdquo; in capitals.
              </li>
              <li className="flex gap-2">
                <SearchCheck aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                Brand name, class/type, alcohol content (as a percentage), net contents, and the bottler&apos;s name and address.
              </li>
              <li className="flex gap-2">
                <Pencil aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                Optionally, the values from the application. Reviewers can also fix a misread; the original reading is kept.
              </li>
            </ul>
          </div>
          <div className="rounded-lg border border-border bg-muted/40 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              What this tool does not do
            </p>
            <ul className="space-y-1.5 text-sm">
              <li className="flex gap-2">
                <X aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                Connect to COLA or submit anything to TTB systems
              </li>
              <li className="flex gap-2">
                <X aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                Replace human compliance review
              </li>
            </ul>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
