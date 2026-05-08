'use client';

import { createContext, useContext, type ReactNode } from 'react';

const OwnerTimezoneContext = createContext<string>('UTC');

interface ProviderProps {
  timezone: string;
  children: ReactNode;
}

/**
 * Carries the owner's settings timezone down through admin client components.
 * Server layouts read `user.timezone` and render this provider; client pages
 * call `useOwnerTimezone()` to format dates/times consistently.
 */
export function OwnerTimezoneProvider({ timezone, children }: ProviderProps) {
  return (
    <OwnerTimezoneContext.Provider value={timezone}>{children}</OwnerTimezoneContext.Provider>
  );
}

export function useOwnerTimezone(): string {
  return useContext(OwnerTimezoneContext);
}
