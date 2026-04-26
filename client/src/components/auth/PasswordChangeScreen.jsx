import PasswordField from "./PasswordField";

export default function PasswordChangeScreen({ passwordForm, setPasswordForm, onSubmit, error, user }) {
  return (
    <div className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">{user.name}</p>
        <h1>Set Your Password</h1>
        <p className="lead">Your temporary password worked. Please set a new permanent password before continuing.</p>
        {error ? <div className="error-banner">{error}</div> : null}
        <form className="control-card auth-form" onSubmit={onSubmit}>
          <PasswordField
            label="Current Password"
            value={passwordForm.currentPassword}
            onChange={(event) => setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))}
            required
            autoComplete="current-password"
          />
          <PasswordField
            label="New Password"
            value={passwordForm.newPassword}
            onChange={(event) => setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))}
            required
            minLength={8}
            autoComplete="new-password"
          />
          <button className="primary-btn" type="submit">Save Password</button>
        </form>
      </section>
    </div>
  );
}
