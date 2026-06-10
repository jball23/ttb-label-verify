import type { Metadata } from 'next';
import './globals.scss';

export const metadata: Metadata = {
  title: 'TTB Label Verification',
  description:
    'AI-assisted compliance verification for alcohol beverage labels against TTB requirements.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <a className="usa-skipnav" href="#main-content">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
