import { useEffect, useState } from 'react';
import { api } from './api';
import { BASE, at } from './config';
import App from './App';
import type { User } from './types';
import { Signup } from './components/Signup';
import { Invite } from './components/Invite';
import { Landing } from './components/Landing';
import { Login } from './components/Login';
import { ResetPassword } from './components/ResetPassword';

// The page within the app, without the base path it may live under.
const here = () => (BASE && location.pathname.startsWith(BASE) ? location.pathname.slice(BASE.length) || '/' : location.pathname);

/** Moves to another page of the site without reloading. */
export function go(path: string) {
  history.pushState(null, '', at(path));
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/**
 * Signed out: the landing page (/), creating an account (/start), sign in (/login), invite links (/invite/<token>)
 * and password reset links (/reset/<token>).
 * Signed in: the app, on any address.
 */
export function Gate() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [path, setPath] = useState(here);

  useEffect(() => {
    api.me().then(setUser, () => setUser(null));
    const out = () => setUser(null);
    const moved = () => {
      setPath(here());
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
    if (here() !== '/') go('/');
  };

  if (user === undefined) return null;
  if (path.startsWith('/invite/')) return <Invite token={path.split('/')[2] ?? ''} onSignedIn={signedIn} />;
  if (path.startsWith('/reset/')) return <ResetPassword token={path.split('/')[2] ?? ''} onSignedIn={signedIn} />;
  if (user) return <App user={user} />;
  if (path === '/login') return <Login onSignedIn={signedIn} />;
  if (path === '/start') return <Signup onSignedIn={signedIn} />;
  return <Landing />;
}
