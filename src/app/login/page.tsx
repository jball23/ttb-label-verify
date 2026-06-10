import LoginForm from './login-form';

export const dynamic = 'force-dynamic';

interface LoginPageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const hasError = params.error === '1';

  return (
    <main id="main-content">
      <div className="grid-container padding-y-6">
        <div className="grid-row">
          <div className="grid-col-12 tablet:grid-col-6 tablet:grid-offset-3">
            <h1 className="font-serif-xl margin-bottom-2">
              TTB Label Verification
            </h1>
            <p className="font-sans-md text-base-darker margin-bottom-4">
              This is a prototype demo. Enter the demo password to continue.
            </p>
            <LoginForm hasError={hasError} />
          </div>
        </div>
      </div>
    </main>
  );
}
