import { useEffect, useState } from 'react';
import { api } from './api';
import App from './App';
import { Login } from './components/Login';

/** Shows the sign-in screen until there's a session, and again if it expires or the user signs out. */
export function Gate() {
  const [state, setState] = useState<'checking' | 'out' | 'in'>('checking');

  useEffect(() => {
    api
      .me()
      .then(() => setState('in'))
      .catch(() => setState('out'));
    const expired = () => setState('out');
    window.addEventListener('auth:expired', expired);
    return () => window.removeEventListener('auth:expired', expired);
  }, []);

  if (state === 'checking') return null;
  return state === 'in' ? <App /> : <Login onSignedIn={() => setState('in')} />;
}
