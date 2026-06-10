'use client';

import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface Props {
  hasError: boolean;
}

export default function LoginForm({ hasError }: Props) {
  return (
    <Card className="border-border/60">
      <CardContent className="p-6">
        {hasError && (
          <Alert variant="destructive" className="mb-5">
            <AlertCircle />
            <AlertDescription>
              That password was not correct. Try again.
            </AlertDescription>
          </Alert>
        )}
        <form action="/api/auth" method="post" noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="password">Demo password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              autoFocus
              aria-invalid={hasError}
              aria-describedby={hasError ? 'password-error' : undefined}
            />
          </div>
          <Button type="submit" className="w-full" size="lg">
            Continue
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
