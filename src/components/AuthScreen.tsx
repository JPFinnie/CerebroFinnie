type AuthScreenProps = {
  email: string;
  password: string;
  isSubmitting: boolean;
  message: string | null;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSignIn: () => void;
};

export function AuthScreen({ email, password, isSubmitting, message, onEmailChange, onPasswordChange, onSignIn }: AuthScreenProps) {
  return (
    <div className="loading-shell auth-shell">
      <p className="eyebrow">Cerebro Atlas</p>
      <h1>Private access to your Obsidian terrain.</h1>
      <p>
        Sign in to load the latest vault snapshot from Supabase. Your vault stays local; only the published snapshot is
        served to this app.
      </p>

      <form
        className="auth-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSignIn();
        }}
      >
        <label className="mini-label" htmlFor="login-email">
          Email
        </label>
        <input
          id="login-email"
          className="search-input"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => onEmailChange(event.target.value)}
        />
        <label className="mini-label" htmlFor="login-password">
          Password
        </label>
        <input
          id="login-password"
          className="search-input"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
        />
        <button type="submit" className="camera-button auth-button" disabled={isSubmitting}>
          {isSubmitting ? 'Signing in...' : 'Sign in'}
        </button>
      </form>

      <p className="support-copy">{message ?? 'Enter your credentials to access your private vault.'}</p>
    </div>
  );
}
