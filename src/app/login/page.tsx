import LoginForm from './login-form';
import { ThemeToggle } from '@/components/theme-toggle';

export const dynamic = 'force-dynamic';

interface LoginPageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const hasError = params.error === '1';

  return (
    <div className="relative flex min-h-svh flex-col">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <main
        id="main-content"
        className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6"
      >
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
              <span className="size-1.5 rounded-full bg-[var(--success)]" />
              Internal demo
            </div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              TTB Label Verification
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Enter the demo password to continue.
            </p>
          </div>
          <LoginForm hasError={hasError} />
        </div>
      </main>
      <footer className="border-t border-border px-6 py-4 text-center text-xs text-muted-foreground">
        AI-assisted compliance checks · prototype
      </footer>
    </div>
  );
}
