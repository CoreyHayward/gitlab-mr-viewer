import { Suspense } from 'react';
import HomeContent from './HomeContent';

export default function HomePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-gray-600 dark:text-gray-400">Loading...</div>
      </div>
    }>
      <HomeContent />
    </Suspense>
  );
}
