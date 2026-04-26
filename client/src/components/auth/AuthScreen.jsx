export default function AuthScreen({ loginForm, setLoginForm, onSubmit, error }) {
  return (
    <div className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">Get Ready Tracking System</p>
        <h1>Sign In</h1>
        <p className="lead">Enter your dealership email to access your task queue and audit trail.</p>
        {error ? <div className="error-banner">{error}</div> : null}
        <form className="control-card auth-form" onSubmit={onSubmit}>
          <label>
            Email
            <input
              type="email"
              value={loginForm.email}
              onChange={(event) => setLoginForm((current) => ({ ...current, email: event.target.value }))}
              required
              autoComplete="email"
            />
          </label>
          <button className="primary-btn" type="submit">Sign In</button>
        </form>
      </section>
    </div>
  );
}
