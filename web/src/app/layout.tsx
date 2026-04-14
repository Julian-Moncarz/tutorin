import type { Metadata } from 'next';
import './globals.css';
import FeedbackButton from '@/components/FeedbackButton';

export const metadata: Metadata = {
  title: 'Tutorin',
  description: 'Ace your test',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,600,700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen">
        {children}
        <FeedbackButton />
      </body>
    </html>
  );
}
