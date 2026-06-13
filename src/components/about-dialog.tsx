'use client';

import { useState } from 'react';
import { Archive, FileText, MapPin, SearchCheck, ShieldCheck, X } from 'lucide-react';
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
            A prototype for AI-assisted TTB label compliance checks.
          </DialogDescription>
        </DialogHeader>
        <DialogContent className="space-y-4">
          <p className="text-muted-foreground">
            Upload one or more filled TTB Form 5100.31 COLA PDFs. The verifier
            reads only the form fields and label artwork needed to assess the
            submitted label.
          </p>
          <div className="rounded-lg border border-border bg-muted/40 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              How it works
            </p>
            <ul className="space-y-2 text-sm">
              <li className="flex gap-2">
                <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                Parses known COLA form fields from the PDF text layer,
                including Item 5 product type, when available.
              </li>
              <li className="flex gap-2">
                <SearchCheck className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                Compares Item 5 product type to the label&apos;s class/type
                designation; Item 7 fanciful name is kept as context.
              </li>
              <li className="flex gap-2">
                <SearchCheck className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                Runs OCR on the affixed label artwork and uses OpenAI fallback
                only for fields OCR cannot read confidently.
              </li>
              <li className="flex gap-2">
                <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                Shows source boxes for PDF/OCR reads. AI fallback values are
                labeled when an exact box is unavailable.
              </li>
              <li className="flex gap-2">
                <Archive className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                Routes results through Queue, Approved or Rejected, Finalized,
                then Archive after human review.
              </li>
            </ul>
          </div>
          <div className="rounded-lg border border-border bg-muted/40 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              What this tool does not do
            </p>
            <ul className="space-y-1.5 text-sm">
              <li className="flex gap-2">
                <X className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                Submit anything to COLAs or TTB systems
              </li>
              <li className="flex gap-2">
                <X className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                Replace human compliance review
              </li>
              <li className="flex gap-2">
                <X className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                Guarantee that OCR or AI fallback found every visual field
              </li>
              <li className="flex gap-2">
                <X className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                Lock a finalized decision until the row is archived
              </li>
            </ul>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
