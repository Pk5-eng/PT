import { useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { Alert } from './Icons.jsx';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setBusy(false);
  }

  return (
    <div className="signin">
      <form onSubmit={submit}>
        <div className="glyph">KA</div>
        <h1>KA Projects</h1>
        <p className="sub">Kabra Architects</p>

        {/* There is no sign-up and no password reset here on purpose: accounts
            are created by hand in Supabase, ten of them, once. */}
        <label htmlFor="email">Email</label>
        <input id="email" type="email" value={email} autoComplete="username"
               autoCapitalize="none" autoFocus required onChange={(e) => setEmail(e.target.value)} />
        <label htmlFor="password">Password</label>
        <input id="password" type="password" value={password} autoComplete="current-password"
               required onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="err"><Alert size={15} />{error}</p>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
