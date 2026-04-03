type AuthScreenProps = {
  email: string;
  isSubmitting: boolean;
  message: string | null;
  onEmailChange: (value: string) => void;
  onSendLink: () => void;
};

export function AuthScreen({ email, isSubmitting, message, onEmailChange, onSendLink }: AuthScreenProps) {
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
          onSendLink();
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
        <button type="submit" className="camera-button auth-button" disabled={isSubmitting}>
          {isSubmitting ? 'Sending link...' : 'Email me a sign-in link'}
        </button>
      </form>

      <p className="support-copy">{message ?? 'Use the magic link on the same device and the session will persist.'}</p>
    </div>
  );
}
