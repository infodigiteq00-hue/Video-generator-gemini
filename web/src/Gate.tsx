import { useEffect, useState } from 'react';
import { api } from './api';
import App from './App';
import type { User } from './types';
import { BrandSetup } from './components/BrandSetup';
import { Invite } from './components/Invite';
import { Landing } from './components/Landing';
import { Login } from './components/Login';

/** Moves to another page of the site without reloading. */
export function go(path: string) {
  history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/**
 * Signed out: the landing page (/), the signup funnel (/start), sign in (/login) and invite links (/invite/<token>).
 * Signed in: the app, on any address.
 */
export function Gate() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [path, setPath] = useState(location.pathname);

  useEffect(() => {
    api.me().then(setUser, () => setUser(null));
    const out = () => setUser(null);
    const moved = () => {
      setPath(location.pathname);
      document.getElementById('root')?.scrollTo?.(0, 0);
    };
    window.addEventListener('auth:expired', out);
    window.addEventListener('popstate', moved);
    return () => {
      window.removeEventListener('auth:expired', out);
      window.removeEventListener('popstate', moved);
    };
  }, []);

  const signedIn = (u: User) => {
    setUser(u);
    if (location.pathname !== '/') go('/');
  };

  if (user === undefined) return null;
  if (path.startsWith('/invite/')) return <Invite token={path.split('/')[2] ?? ''} onSignedIn={signedIn} />;
  if (user) return <App user={user} />;
  if (path === '/login') return <Login onSignedIn={signedIn} />;
  if (path === '/start') return <BrandSetup asPage signup brand={null} onClose={() => go('/')} onSaved={() => {}} onSignedUp={signedIn} />;
  return <Landing />;
}
